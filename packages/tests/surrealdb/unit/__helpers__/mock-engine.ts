import {
    type BoundQuery,
    type ConnectOptions,
    type DriverOptions,
    type EngineEvents,
    Features,
    Publisher,
    type QueryChunk,
    type RequestOptions,
    RpcEngine,
    type RpcRequest,
    type Session,
    Surreal,
    type SurrealEngine,
    type Uuid,
} from "surrealdb";

/** One request an engine was asked to send, with the options it was given. */
export interface SentRequest {
    request: RpcRequest;
    options?: RequestOptions;
}

/**
 * An engine with nothing behind it, for driving the query API as a caller would.
 *
 * It is an `RpcEngine`, so queries reach it through the real `query` method and arrive at `send`
 * with the options the SDK hands an engine. Every request is recorded, and a test decides how it
 * is answered by assigning `respond`. To control the chunks of a query directly, such as to tell
 * whether an iterator was returned, assign `queryImpl`.
 */
export class FakeEngine extends RpcEngine implements SurrealEngine {
    #publisher = new Publisher<EngineEvents>();

    /** Every request sent, other than the handshake. */
    readonly sent: SentRequest[] = [];

    /** Every request which was begun, and has not ended. */
    inFlight = 0;

    /** Answers a request. The default is one successful statement with no rows. */
    respond: (request: RpcRequest, options?: RequestOptions) => Promise<unknown> = async () => [
        { status: "OK", time: "1ms", result: [], type: "other" },
    ];

    /** Replaces `query`, to hand back chunks the test controls. */
    queryImpl:
        | ((
              query: BoundQuery,
              session: Session,
              txn?: Uuid,
              options?: RequestOptions,
          ) => AsyncIterable<QueryChunk<unknown>>)
        | undefined;

    features: SurrealEngine["features"] = new Set([Features.Api, Features.Transactions]);

    subscribe<K extends keyof EngineEvents>(
        event: K,
        listener: (...payload: EngineEvents[K]) => void,
    ): () => void {
        return this.#publisher.subscribe(event, listener);
    }

    open(state: Parameters<SurrealEngine["open"]>[0]): void {
        this._state = state;
        setTimeout(() => this.#publisher.publish("connected"));
    }

    async close(): Promise<void> {
        this._state = undefined;
        this.#publisher.publish("disconnected");
    }

    ready(): void {}

    override async send<Method extends string, Params extends unknown[] | undefined, Result>(
        request: RpcRequest<Method, Params>,
        options?: RequestOptions,
    ): Promise<Result> {
        if (request.method === "version") return "surrealdb-3.0.0" as Result;

        this.sent.push({ request: request as RpcRequest, options });
        this.inFlight++;

        try {
            return (await this.respond(request as RpcRequest, options)) as Result;
        } finally {
            this.inFlight--;
        }
    }

    override query<T>(
        query: BoundQuery,
        session: Session,
        txn?: Uuid,
        options?: RequestOptions,
    ): AsyncIterable<QueryChunk<T>> {
        if (this.queryImpl) {
            return this.queryImpl(query, session, txn, options) as AsyncIterable<QueryChunk<T>>;
        }

        return super.query<T>(query, session, txn, options);
    }

    override liveQuery(): never {
        throw new Error("Not supported by the fake engine");
    }
}

/**
 * Connect a `Surreal` instance to a fake engine.
 */
export async function connectFake(
    options: ConnectOptions = {},
    driver: DriverOptions = {},
): Promise<{ db: Surreal; engine: FakeEngine }> {
    const engine = new FakeEngine({
        options: driver,
        uniqueId: () => "fake",
        codecs: undefined as never,
    });

    const db = new Surreal({ ...driver, engines: { fake: () => engine } });
    await db.connect("fake://", { versionCheck: false, ...options });

    return { db, engine };
}

/**
 * An answer which never comes, until the request is abandoned.
 */
export function hang(options?: RequestOptions): Promise<never> {
    return new Promise<never>((_, reject) => {
        options?.signal?.addEventListener("abort", () => reject(options.signal?.reason), {
            once: true,
        });
    });
}

/**
 * An answer which never comes, whatever happens to the request, for an engine which ignores
 * signals altogether.
 */
export function stall(): Promise<never> {
    return new Promise<never>(() => {});
}
