import type { Uuid } from "@surrealdb/sqon";
import type { ConnectionController } from "../controller";
import {
    CallTerminatedError,
    ConnectionUnavailableError,
    LiveQueryOverflowError,
    LiveSubscriptionError,
} from "../errors";
import type { AbortScope } from "../internal/abort";
import { LIVE_QUERY_BUFFER_LIMIT } from "../internal/live-query-buffer";
import { Query } from "../query";
import type { LiveMessage, LiveResource, Session } from "../types";
import { BoundQuery } from "./bound-query";
import { ChannelIterator } from "./channel-iterator";

// Kill does not compute paramters yet :(
function newKill(id: Uuid): BoundQuery {
    return new BoundQuery(`KILL u"${id.toString()}"`);
}

/**
 * Kill a live query on the server. Kills and registrations on the same table conflict with one
 * another, so a kill which is reported as a conflict, and so did nothing, is retried, rather than
 * leaving behind a live query which nobody is listening to.
 */
function killLive(controller: ConnectionController, session: Session, id: Uuid): Query {
    return new Query(controller, {
        query: newKill(id),
        transaction: undefined,
        session,
        json: false,
        retry: true,
    });
}

/**
 * Whether an error means the connection is gone, and with it every live query it held, so that a
 * subscription being torn down has nothing left to kill.
 */
function isConnectionGone(error: unknown): boolean {
    return error instanceof ConnectionUnavailableError || error instanceof CallTerminatedError;
}

/**
 * Tie a subscription to the signals it was made with, so that it is killed when they abort.
 *
 * The signals belong to the subscription from here on, rather than to the call which made it, as it
 * outlives that call. `unwatch` lets go of them, and the subscription calls it however it ends.
 */
function watchAbort(
    abort: AbortScope | undefined,
    onAbort: () => void,
): { unwatch: () => void } | undefined {
    const signal = abort?.signal;

    if (!abort || !signal) return undefined;

    signal.addEventListener("abort", onAbort, { once: true });

    return {
        unwatch: () => {
            signal.removeEventListener("abort", onAbort);
            abort.dispose();
        },
    };
}

/**
 * Represents a subscription to a LIVE SELECT query
 */
export abstract class LiveSubscription<T = Record<string, unknown>>
    implements AsyncIterable<LiveMessage<T>>
{
    /**
     * The ID of the live subscription. Note that this id might change after
     * a live query has been restarted.
     */
    abstract get id(): Uuid;

    /**
     * Returns whether this LiveQuery is managed by the driver and may be automatically
     * restarted once the connection is re-established.
     */
    abstract get isManaged(): boolean;

    /**
     * The live resource that this subscription is tracking, if any.
     */
    abstract get resource(): LiveResource | undefined;

    /**
     * Whether the LiveQuery is considered alive. Although the connection may be
     * disconnected, the LiveQuery may still be alive if it is managed by the driver.
     */
    abstract get isAlive(): boolean;

    /**
     * Kill the live subscription and stop receiving updates
     */
    abstract kill(): Promise<void>;

    /**
     * The async iterator for the live subscription
     */
    abstract [Symbol.asyncIterator](): AsyncIterator<LiveMessage<T>>;

    /**
     * Subscribe to the live subscription and return an unsubscribe function
     */
    public subscribe(
        handler: (message: LiveMessage<T>) => void,
        onError?: (error: unknown) => void,
    ): () => void {
        let stopped = false;
        let iterator: AsyncIterator<LiveMessage<T>> | undefined;

        const report = (error: unknown) => {
            if (onError) onError(error);
            else throw error;
        };

        (async () => {
            const reading = this[Symbol.asyncIterator]();
            iterator = reading;

            for await (const message of { [Symbol.asyncIterator]: () => reading }) {
                if (stopped) return;
                handler(message);
            }
        })().catch((error) => {
            if (!stopped) report(error);
        });

        return () => {
            stopped = true;
            iterator?.return?.()?.catch(report);
        };
    }
}

/**
 * A managed live subscription that is automatically restarted when the connection
 * is re-established.
 */
export class ManagedLiveSubscription<T = Record<string, unknown>> extends LiveSubscription<T> {
    #currentId!: Uuid;
    #controller: ConnectionController;
    #resource: LiveResource;
    #session: Session;
    #query: Query;
    #killed = false;
    #serverKilled = false;
    #channels: Set<ChannelIterator<LiveMessage<T>>> = new Set();
    #unsubscribe: () => void;
    #unwatch: () => void = () => {};
    #killing: Promise<void> | undefined;
    #stream: AsyncIterator<LiveMessage> | undefined;
    #ready: Promise<void> = Promise.resolve();

    /**
     * @param abort When given, the subscription is killed once its signal aborts, and the scope is
     *              let go of when the subscription ends.
     */
    constructor(
        controller: ConnectionController,
        resource: LiveResource,
        session: Session,
        query: Query,
        abort?: AbortScope,
    ) {
        super();
        this.#controller = controller;
        this.#resource = resource;
        this.#session = session;
        this.#query = query;
        this.#unwatch = watchAbort(abort, () => void this.#abandon())?.unwatch ?? this.#unwatch;

        this.#unsubscribe = this.#controller.subscribe("connected", () => {
            // Re-establish the subscription in the background on reconnect.
            this.#listen().catch(() => {
                // Errors are already surfaced via propagateError inside #listen.
            });
        });

        if (this.#controller.status === "connected") {
            this.#ready = this.#listen();

            // Awaiting `ready()` is optional, and the registration fails with the connection it
            // was made on - which `#listen` has already reported on the error channel - so the
            // promise is kept from going unhandled. Callers who do await it still see it fail.
            this.#ready.catch(() => {});
        }
    }

    /**
     * Resolves once the live query has been registered on the server and this
     * client is subscribed to its notification stream. Callers can await this
     * before issuing writes to guarantee no notification is missed.
     */
    public ready(): Promise<void> {
        return this.#ready;
    }

    public get id(): Uuid {
        return this.#currentId;
    }

    public get isManaged(): boolean {
        return true;
    }

    public get resource(): LiveResource {
        return this.#resource;
    }

    public get isAlive(): boolean {
        // Alive until permanent teardown: killed explicitly, the owning session
        // destroyed, or the connection closed for good. hasSession() stays true
        // across a transient reconnect, whose state is not cleared.
        return !this.#killed && !this.#serverKilled && this.#controller.hasSession(this.#session);
    }

    /**
     * Kill the live subscription. Killing it again, or after its signal aborted, is a no-op which
     * waits for the first kill, so that a `finally` block can kill it whatever came first.
     */
    public kill(): Promise<void> {
        this.#killing ??= this.#kill();

        return this.#killing;
    }

    async #kill(): Promise<void> {
        this.#killed = true;
        this.#unwatch();

        for (const channel of this.#channels) {
            channel.cancel();
        }

        this.#unsubscribe();
        this.#release(this.#stream);

        if (this.id) {
            await killLive(this.#controller, this.#session, this.id);
        }
    }

    public [Symbol.asyncIterator](): AsyncIterator<LiveMessage<T>> {
        if (this.#killed) {
            throw new LiveSubscriptionError("Subscription has been killed");
        }

        const channel = new ChannelIterator<LiveMessage<T>>(() => {
            this.#channels.delete(channel);
        });

        this.#channels.add(channel);

        return channel;
    }

    /**
     * The signal of the subscription aborted: end it like a kill does, and tell the server.
     *
     * Aborting is the normal end of a live stream, so iteration ends cleanly rather than throwing,
     * and `isAlive` turns false at once. A failure to kill is reported on the error channel, unless it
     * is only that the connection is gone, which takes the live query with it.
     */
    async #abandon(): Promise<void> {
        try {
            await this.kill();
        } catch (err: unknown) {
            if (!isConnectionGone(err)) {
                this.#controller.propagateError(new LiveSubscriptionError(err));
            }
        }
    }

    async #killRegistered(id: Uuid): Promise<void> {
        try {
            await killLive(this.#controller, this.#session, id);
        } catch (err: unknown) {
            if (!isConnectionGone(err)) {
                this.#controller.propagateError(new LiveSubscriptionError(err));
            }
        }
    }

    async #listen(): Promise<void> {
        let messageStream: AsyncIterable<LiveMessage>;

        try {
            const [id] = await this.#query.collect<[Uuid]>();

            this.#currentId = id;

            // Killed while this was in flight, so that the server registered a live query which
            // nobody is going to listen to, and which only a kill can end
            if (this.#killed) {
                await this.#killRegistered(id);
                return;
            }

            // Subscribe to the notification stream immediately after the query
            // resolves. The engine buffers any notification that arrived before
            // this point, so the window between server registration and this
            // subscription cannot drop notifications.
            messageStream = this.#controller.liveQuery(id);
            this.#stream = messageStream[Symbol.asyncIterator]();
        } catch (err: unknown) {
            const error = new LiveSubscriptionError(err);

            // Nobody is left to hear of a registration which was given up on because the
            // subscription was killed while it waited to be sent, which is not a failure
            if (!this.#killed) this.#controller.propagateError(error);

            throw error;
        }

        // Fan out notifications to consumers in the background; the round-trip
        // is complete, so #listen (and thus ready()) may resolve now.
        void this.#consume(this.#stream as AsyncIterator<LiveMessage>);
    }

    /**
     * Stop reading the notifications of a live query which has ended, which releases the engine's
     * hold on them. A server which does not announce the end of a killed live query would otherwise
     * leave it held for as long as the connection lasts.
     */
    #release(stream: AsyncIterator<LiveMessage> | undefined): void {
        stream?.return?.()?.catch(() => {});
    }

    async #consume(stream: AsyncIterator<LiveMessage>): Promise<void> {
        try {
            for await (const message of { [Symbol.asyncIterator]: () => stream }) {
                for (const channel of this.#channels) {
                    channel.submit(message as LiveMessage<T>);
                }

                // A server-side KILLED (e.g. the subscription's table was
                // removed) is terminal: deliver it, stop tracking, and do not
                // restart on reconnect. isAlive flips to false.
                if (message.action === "KILLED") {
                    this.#serverKilled = true;
                    this.#unwatch();
                    this.#unsubscribe();

                    for (const channel of this.#channels) {
                        channel.cancel();
                    }

                    return;
                }
            }
        } catch (err: unknown) {
            this.#controller.propagateError(new LiveSubscriptionError(err));
        }
    }
}

/**
 * An unmanaged live subscription which is constructed with only
 * a known pre-existing ID. This subscription will not be automatically
 * restarted when the connection is re-established.
 */
export class UnmanagedLiveSubscription<T = Record<string, unknown>> extends LiveSubscription<T> {
    #id: Uuid;
    #controller: ConnectionController;
    #session: Session;
    #connectionEpoch: number;
    #killed = false;
    #ended = false;
    #serverKilled = false;
    #failure: LiveSubscriptionError | undefined;
    #unwatch: (() => void) | undefined;
    #unlink: () => void = () => {};
    #release: (error?: Error) => void = () => {};
    #killing: Promise<void> | undefined;
    #channels = new Set<ChannelIterator<LiveMessage<T>>>();
    #pending: LiveMessage<T>[] | undefined = [];

    /**
     * @param abort When given, the registration is killed once its signal aborts.
     */
    constructor(controller: ConnectionController, session: Session, id: Uuid, abort?: AbortScope) {
        super();

        if (controller.status !== "connected") {
            throw new ConnectionUnavailableError();
        }

        this.#controller = controller;
        this.#session = session;
        this.#id = id;
        this.#connectionEpoch = controller.connectionEpoch;
        this.#unwatch = watchAbort(abort, () => void this.#abandon())?.unwatch;

        const end = () => this.#disconnect();
        const disconnect = controller.subscribe("disconnected", end);
        const reconnect = controller.subscribe("reconnecting", end);
        this.#unlink = () => {
            disconnect();
            reconnect();
        };

        try {
            const unsubscribe = controller.subscribeLiveQuery(id, {
                message: (message) => this.#receive(message as LiveMessage<T>),
                overflow: (limit, serverKilled) => this.#overflow(limit, serverKilled),
                error: (error) => {
                    if (!this.#ended) this.#fail(new LiveSubscriptionError(error));
                },
            });

            if (unsubscribe) {
                // Replay may already have ended the subscription synchronously.
                if (this.#ended) unsubscribe(this.#failure);
                else this.#release = unsubscribe;
            } else {
                const stream = controller.liveQuery(id)[Symbol.asyncIterator]();
                this.#release = () => stream.return?.()?.catch(() => {});
                void this.#consume(stream);
            }
        } catch (error) {
            this.#releaseAbort();
            this.#unlink();
            throw error;
        }
    }

    #receive(message: LiveMessage<T>): void {
        if (this.#ended || this.#killed) return;

        const pending = this.#pending;

        if (pending) {
            if (pending.length >= LIVE_QUERY_BUFFER_LIMIT) {
                this.#overflow(LIVE_QUERY_BUFFER_LIMIT, message.action === "KILLED");
                return;
            }

            pending.push(message);
        } else {
            for (const channel of this.#channels) channel.submit(message);
        }

        if (message.action === "KILLED") {
            this.#serverKilled = true;
            this.#finish();
        }
    }

    async #consume(stream: AsyncIterator<LiveMessage>): Promise<void> {
        try {
            while (!this.#ended && !this.#killed) {
                const next = await stream.next();

                if (next.done) {
                    this.#finish();
                    return;
                }

                this.#receive(next.value as LiveMessage<T>);
            }
        } catch (error) {
            if (!this.#ended && !this.#killed) {
                this.#fail(new LiveSubscriptionError(error));
            }
        }
    }

    #overflow(limit: number, serverKilled: boolean): void {
        this.#serverKilled = serverKilled;

        if (serverKilled) this.#releaseAbort();

        this.#fail(new LiveQueryOverflowError(this.id, limit));
    }

    #fail(failure: LiveSubscriptionError): void {
        this.#ended = true;
        this.#pending = undefined;
        this.#failure = failure;
        this.#releaseSource();

        // A scoped subscription still owes its requested abort-time KILL. An unscoped
        // listener may share this ID with others; delivery failure only ends this listener.
        if (!this.#unwatch) this.#unlink();
        for (const channel of this.#channels) channel.fail(failure);
    }

    #finish(): void {
        if (this.#ended) return;

        this.#ended = true;
        this.#releaseAbort();
        this.#detach();
        for (const channel of this.#channels) channel.finish();
    }

    #disconnect(): void {
        this.#releaseAbort();
        this.#detach();

        if (!this.#ended) {
            this.#ended = true;
            this.#pending = undefined;
            for (const channel of this.#channels) channel.cancel();
        }
    }

    #releaseAbort(): void {
        this.#unwatch?.();
        this.#unwatch = undefined;
    }

    #detach(): void {
        this.#unlink();
        this.#releaseSource();
    }

    #releaseSource(): void {
        const release = this.#release;
        this.#release = () => {};
        release(this.#failure);
    }

    /** The signal of the subscription aborted: end it like a kill does, and tell the server */
    async #abandon(): Promise<void> {
        try {
            await this.kill();
        } catch (error) {
            if (!isConnectionGone(error)) {
                this.#controller.propagateError(new LiveSubscriptionError(error));
            }
        }
    }

    public get id(): Uuid {
        return this.#id;
    }

    public get isManaged(): boolean {
        return false;
    }

    public get resource(): undefined {
        return undefined;
    }

    public get isAlive(): boolean {
        return !this.#killed && !this.#ended && this.#controller.hasSession(this.#session);
    }

    /**
     * Kill the live subscription. Killing it again, or after its signal aborted, is a no-op which
     * waits for the first kill, so that a `finally` block can kill it whatever came first.
     */
    public kill(): Promise<void> {
        this.#killing ??= this.#kill();

        return this.#killing;
    }

    async #kill(): Promise<void> {
        this.#killed = true;
        this.#pending = undefined;
        this.#failure = undefined;
        this.#releaseAbort();
        this.#detach();

        for (const channel of this.#channels) channel.cancel();

        const controller = this.#controller;

        if (
            this.#serverKilled ||
            this.#connectionEpoch !== controller.connectionEpoch ||
            controller.status !== "connected" ||
            !controller.hasSession(this.#session)
        ) {
            return;
        }

        // The request can wait on credentials or retry a conflict. A replacement connection
        // never owned this registration, so prevent any delayed send on that connection.
        const lifetime = new AbortController();
        const lost = () => lifetime.abort(new ConnectionUnavailableError());
        const disconnect = controller.subscribe("disconnected", lost);
        const reconnect = controller.subscribe("reconnecting", lost);

        try {
            await killLive(controller, this.#session, this.id).signal(lifetime.signal);
        } catch (error) {
            if (!lifetime.signal.aborted && !isConnectionGone(error)) throw error;
        } finally {
            disconnect();
            reconnect();
        }
    }

    public [Symbol.asyncIterator](): AsyncIterator<LiveMessage<T>> {
        if (this.#killed) {
            throw new LiveSubscriptionError("Subscription has been killed");
        }

        const channel = new ChannelIterator<LiveMessage<T>>(() => {
            this.#channels.delete(channel);
        });

        // Only the first consumer receives the retained prefix. Later consumers join at the
        // current position, even if the first one left before reading its entire queue.
        const pending = this.#pending;
        this.#pending = undefined;

        if (pending) {
            for (const message of pending) channel.submit(message);
        }

        if (this.#failure) {
            channel.fail(this.#failure);
        } else if (this.#ended) {
            channel.finish();
        } else {
            this.#channels.add(channel);
        }

        return channel;
    }

    public override subscribe(
        handler: (message: LiveMessage<T>) => void,
        onError = (error: unknown) => {
            this.#controller.propagateError(
                error instanceof LiveSubscriptionError ? error : new LiveSubscriptionError(error),
            );
        },
    ): () => void {
        return super.subscribe(handler, onError);
    }
}
