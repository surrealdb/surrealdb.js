import { SurrealError } from "../errors";
import type { AuthCache, Session, Token } from "../types";
import { renewalDelay, tokenExpiry } from "./tokens";

interface Entry {
    token: Token | undefined;
    /** The time in milliseconds until which the token may be reused */
    until: number;
}

/**
 * Validate a cache policy, throwing when it cannot be honoured.
 */
export function assertAuthCache(cache: AuthCache): void {
    if (cache === "until-expiry" || cache === "none") return;

    if (
        typeof cache === "object" &&
        cache !== null &&
        typeof cache.ttl === "number" &&
        Number.isFinite(cache.ttl) &&
        cache.ttl > 0
    ) {
        return;
    }

    throw new SurrealError(
        'The authentication cache must be "until-expiry", "none", or { ttl } with a positive number of seconds',
    );
}

/**
 * Holds the credentials resolved for requests, for each session, and decides when a
 * credential has to be resolved again.
 *
 * - A credential is reused until shortly before its expiry, governed by the margin, and
 *   no longer than the `ttl` of the policy. A credential without a known expiry is only
 *   reused when the policy has a `ttl`.
 * - Concurrent requests which need a credential share a single resolution.
 * - A failed resolution is not remembered. The next request resolves again.
 *
 * With the `"none"` policy nothing is stored and nothing is shared, so that the resolver
 * is evaluated once per request. This matters when its answer depends on who is asking. Only
 * when resolving applies the credential to a session held on the other side (`serialize`)
 * are the resolutions for one session made one after the other, as the session ends up with
 * what the last of them applied.
 */
export class RequestCredentials {
    readonly #cache: AuthCache;
    readonly #margin: () => number;
    readonly #now: () => number;
    readonly #entries = new Map<string, Entry>();
    readonly #inflight = new Map<string, Promise<Token | undefined>>();
    readonly #queues = new Map<string, Promise<void>>();
    readonly #serialize: boolean;
    #epoch = 0;

    constructor(options: {
        cache: AuthCache;
        margin: () => number;
        now?: () => number;
        serialize?: boolean;
    }) {
        assertAuthCache(options.cache);

        this.#cache = options.cache;
        this.#serialize = options.serialize ?? false;
        this.#margin = options.margin;
        this.#now = options.now ?? (() => Date.now());
    }

    /**
     * Retrieve the credential for a session, invoking `load` when there is no reusable one.
     *
     * @param session The session the credential is for
     * @param load Resolves a new credential
     * @param rejected A token the server refused. It is not returned from the cache, but a
     * different token resolved in the meantime is.
     */
    async get(
        session: Session,
        load: () => Promise<Token | undefined>,
        rejected?: Token,
    ): Promise<Token | undefined> {
        const key = keyOf(session);

        if (this.#cache === "none") {
            return this.#serialize ? this.#enqueue(key, load) : load();
        }

        const entry = this.#entries.get(key);

        if (
            entry &&
            entry.until > this.#now() &&
            (rejected === undefined || entry.token !== rejected)
        ) {
            return entry.token;
        }

        const pending = this.#inflight.get(key);

        if (pending) {
            return pending;
        }

        const epoch = this.#epoch;
        const resolution: Promise<Token | undefined> = this.#resolve(key, load, epoch).finally(
            () => {
                if (this.#inflight.get(key) === resolution) {
                    this.#inflight.delete(key);
                }
            },
        );

        this.#inflight.set(key, resolution);

        return resolution;
    }

    /**
     * Run `load` after the resolutions which were asked for before it, for the same session
     */
    #enqueue(key: string, load: () => Promise<Token | undefined>): Promise<Token | undefined> {
        const previous = this.#queues.get(key);
        const run = previous ? previous.then(() => load()) : load();
        const tail: Promise<void> = run
            .then(
                () => undefined,
                () => undefined,
            )
            .finally(() => {
                if (this.#queues.get(key) === tail) this.#queues.delete(key);
            });

        this.#queues.set(key, tail);

        return run;
    }

    async #resolve(
        key: string,
        load: () => Promise<Token | undefined>,
        epoch: number,
    ): Promise<Token | undefined> {
        const token = await load();
        const until = this.#reuseUntil(token);

        // Do not store what was resolved if the session was forgotten meanwhile
        if (epoch === this.#epoch && until > this.#now()) {
            this.#entries.set(key, { token, until });
        } else {
            this.#entries.delete(key);
        }

        return token;
    }

    /**
     * Discard what is remembered for a session. A resolution which is still in flight for
     * it is not remembered once it completes.
     */
    forget(session: Session): void {
        const key = keyOf(session);

        this.#epoch++;
        this.#entries.delete(key);
        this.#inflight.delete(key);
    }

    /**
     * Discard what is remembered for every session.
     */
    clear(): void {
        this.#epoch++;
        this.#entries.clear();
        this.#inflight.clear();
    }

    #reuseUntil(token: Token | undefined): number {
        const now = this.#now();
        const expiry = token === undefined ? undefined : tokenExpiry(token);
        let until = 0;

        if (expiry !== undefined) {
            const remaining = expiry - now / 1000;

            if (remaining > 0) {
                until = now + renewalDelay(remaining, this.#margin()) * 1000;
            }
        }

        if (typeof this.#cache === "object") {
            const bound = now + this.#cache.ttl * 1000;

            until = expiry !== undefined ? Math.min(until, bound) : bound;
        }

        return until;
    }
}

function keyOf(session: Session): string {
    return session ? session.toString() : "";
}
