import { type MaybeJsonify, maybeJsonify } from "../internal/maybe-jsonify";
import type { QueryChunk, QueryStats, QueryType } from "../types";

/**
 * One statement of a query, completed, as `statements()` yields it.
 */
export interface StatementResult<T = unknown> {
    /** The statement's zero-based position in the query. */
    readonly index: number;
    /** The statement's value: a list of rows, or one bare value when `single` is true. */
    readonly value: T;
    /** What the server reports of the statement's execution. */
    readonly stats: QueryStats | undefined;
    /** `"live"` for a `LIVE SELECT`, `"kill"` for a `KILL`, and `"other"` for the rest. */
    readonly type: QueryType;
    /**
     * Whether `value` is one bare value rather than a list of rows: `SELECT ... FROM ONLY`,
     * `RETURN 1 + 2`, a block.
     */
    readonly single: boolean;
}

/**
 * The per-statement results of a query typed as a tuple of statement results.
 */
export type StatementOf<T extends unknown[], J extends boolean = false> = {
    [K in keyof T]: StatementResult<MaybeJsonify<T[K], J>>;
}[number];

/**
 * What a view reads: the chunks of a query which was asked to be streamed, and what to do once it
 * has finished with them.
 */
export interface ChunkSource {
    chunks: AsyncIterable<QueryChunk<unknown>>;
    /** Releases what the request holds, once the view is done with it by any route. */
    dispose: () => void;
}

/**
 * A view of a streamed query, read once, from the start.
 *
 * Nothing is sent until the first read, so making one costs nothing. Leaving it - by `break`ing out
 * of a `for await`, by `return()`, or by `await using` - stops the query on the server, rather than
 * leaving it to produce results nothing will read, and does so at once: a read which is parked
 * waiting on the server is released, not waited out.
 *
 * It is a plain iterator rather than an async generator for that reason. A generator defers
 * `return()` until the read which is in flight has finished, and a read can be waiting on a result
 * which is not coming for as long as the query takes.
 *
 * **Memory is bounded by the server, not by the reader.** The WebSocket API offers no way to pause
 * reading, so a reader which is slower than the server produces rows holds the difference in memory
 * until it catches up. Leaving the view stops the query, which is the way to stop that.
 */
abstract class StreamView<T> implements AsyncIterableIterator<T> {
    readonly #open: () => Promise<ChunkSource>;
    readonly #queue: T[] = [];
    #starting: Promise<AsyncIterator<QueryChunk<unknown>> | undefined> | undefined;
    #iterator: AsyncIterator<QueryChunk<unknown>> | undefined;
    #dispose: (() => void) | undefined;
    #failure: { error: unknown } | undefined;
    #closed = false;

    constructor(open: () => Promise<ChunkSource>) {
        this.#open = open;
    }

    /**
     * Turns one chunk of the query into zero or more values of the view, by `emit`. Throwing ends
     * the view with that error.
     */
    protected abstract accept(chunk: QueryChunk<unknown>, emit: (value: T) => void): void;

    async next(): Promise<IteratorResult<T>> {
        for (;;) {
            // Tested by length, as a row can be `NONE`: an element of a list can be, and `undefined`
            // would then read as there being nothing queued.
            if (this.#queue.length > 0) {
                return { value: this.#queue.shift() as T, done: false };
            }

            // Once what came before it has been read.
            if (this.#failure) {
                const { error } = this.#failure;

                this.#failure = undefined;
                throw error;
            }

            if (this.#closed) return { value: undefined, done: true };

            const iterator = await this.#start();

            // Left while it was starting: there is nothing to read, and nobody to read it.
            if (!iterator || this.#closed) return { value: undefined, done: true };

            let result: IteratorResult<QueryChunk<unknown>>;

            try {
                result = await iterator.next();
            } catch (error) {
                await this.#close();
                throw error;
            }

            if (result.done) {
                await this.#close();
                return { value: undefined, done: true };
            }

            try {
                this.accept(result.value, (item) => {
                    this.#queue.push(item);
                });
            } catch (error) {
                // Stops the query at once, but what was produced before the failure in this chunk
                // is read first: the failure belongs after it, not in place of it.
                this.#failure = { error };
                await this.#close();
            }
        }
    }

    async return(): Promise<IteratorResult<T>> {
        this.#queue.length = 0;
        this.#failure = undefined;
        await this.#close();

        return { value: undefined, done: true };
    }

    async throw(error?: unknown): Promise<IteratorResult<T>> {
        await this.return();
        throw error;
    }

    [Symbol.asyncIterator](): this {
        return this;
    }

    [Symbol.asyncDispose](): Promise<void> {
        return this.return().then(() => undefined);
    }

    #start(): Promise<AsyncIterator<QueryChunk<unknown>> | undefined> {
        this.#starting ??= (async () => {
            const source = await this.#open();

            this.#dispose = source.dispose;

            const iterator = source.chunks[Symbol.asyncIterator]();

            this.#iterator = iterator;

            // Left before it had started: it is opened and let go of straight away, so that the
            // request which was made is not left running.
            if (this.#closed) {
                await this.#release();
                return undefined;
            }

            return iterator;
        })();

        return this.#starting;
    }

    async #close(): Promise<void> {
        if (this.#closed) return;

        this.#closed = true;

        // Opening may be in flight, in which case it lets go of what it opens itself.
        if (this.#iterator) await this.#release();
    }

    /** Stops the query, then lets go of what its request holds. Once. */
    async #release(): Promise<void> {
        const iterator = this.#iterator;
        const dispose = this.#dispose;

        this.#iterator = undefined;
        this.#dispose = undefined;

        try {
            await iterator?.return?.();
        } finally {
            dispose?.();
        }
    }
}

/**
 * The rows of a streamed query, as they arrive.
 *
 * For a query of several statements these are the rows of each in turn, in the order the server
 * produces them. A statement which is one bare value - `SELECT ... FROM ONLY`, `RETURN 1 + 2` - is
 * one row; one whose value is `NONE`, such as `LET`, is none.
 *
 * **A row is provisional until iteration completes without throwing.** Rows are delivered before
 * the statement which produced them has finished, which is the point of streaming, so a statement
 * which fails after yielding some voids them: iteration throws that statement's error, and what was
 * yielded for it should be discarded. Use `statements()` to receive each statement only once it is
 * final, or the frames of `stream()` to see the failure of one statement while the rest still run.
 */
export class RowStream<T> extends StreamView<T> {
    readonly #json: boolean;
    readonly #parse: ((row: never) => T) | undefined;

    constructor(open: () => Promise<ChunkSource>, json: boolean, parse?: (row: never) => T) {
        super(open);
        this.#json = json;
        this.#parse = parse;
    }

    protected override accept(chunk: QueryChunk<unknown>, emit: (value: T) => void): void {
        if (chunk.error) throw chunk.error;

        if (chunk.kind === "single") {
            const value = chunk.result?.[0];

            if (value !== undefined) emit(this.#row(value));

            return;
        }

        for (const row of chunk.result ?? []) {
            emit(this.#row(row));
        }
    }

    #row(value: unknown): T {
        const row = maybeJsonify(value, this.#json);

        return this.#parse ? this.#parse(row as never) : (row as T);
    }
}

/**
 * The statements of a streamed query, each once it is final.
 *
 * A statement is yielded when the server has said it is complete, with all of its rows, so what is
 * yielded is never retracted. A statement which fails throws its error and ends the iteration.
 *
 * This is the view to choose when the answer to one statement is needed whole before the next is
 * looked at. It buffers each statement's rows until then, so the rows of a statement are not
 * available any sooner than they would have been from `collect()`; what is gained is that the
 * statements are, as each finishes.
 */
export class StatementStream<T> extends StreamView<T> {
    readonly #json: boolean;
    readonly #rows = new Map<number, unknown[]>();

    constructor(open: () => Promise<ChunkSource>, json: boolean) {
        super(open);
        this.#json = json;
    }

    protected override accept(chunk: QueryChunk<unknown>, emit: (value: T) => void): void {
        if (chunk.error) throw chunk.error;

        const { query: index } = chunk;

        if (chunk.kind === "single") {
            emit(this.#statement(chunk, maybeJsonify(chunk.result?.[0], this.#json), true));
            return;
        }

        let rows = this.#rows.get(index);

        if (!rows) {
            rows = [];
            this.#rows.set(index, rows);
        }

        // Pushed one at a time: a statement the buffered protocol delivers whole can be larger
        // than the arguments a call can be given.
        for (const row of chunk.result ?? []) {
            rows.push(maybeJsonify(row, this.#json));
        }

        if (chunk.kind === "batched-final") {
            this.#rows.delete(index);
            emit(this.#statement(chunk, rows, false));
        }
    }

    #statement(chunk: QueryChunk<unknown>, value: unknown, single: boolean): T {
        const result: StatementResult = {
            index: chunk.query,
            value,
            stats: chunk.stats,
            type: chunk.type ?? "other",
            single,
        };

        return result as T;
    }
}
