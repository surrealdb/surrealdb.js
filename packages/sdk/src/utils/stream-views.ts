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
    /**
     * Abandons the request, which is what frees a read parked on an answer which is not coming. A
     * source which is a generator cannot be returned while it is parked, and one which is not
     * streaming is parked for as long as the query runs.
     */
    abort: () => void;
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
 * Reads are made one at a time, in the order they were asked for, so a consumer which has several
 * outstanding - a `Promise.all` over `next()`, or a read raced against a timeout and asked for
 * again - receives each row once, in order, and a `done` only once nothing is left.
 *
 * **Memory is bounded by the server, not by the reader.** The WebSocket API offers no way to pause
 * reading, so a reader which is slower than the server produces rows holds the difference in memory
 * until it catches up. Leaving the view stops the query, which is the way to stop that.
 */
abstract class StreamView<T> implements AsyncIterableIterator<T> {
    readonly #open: () => Promise<ChunkSource>;
    #queue: T[] = [];
    // The next row to hand out. Taken from the front by moving this, not by `shift()`, which moves
    // every row behind it and makes reading a large statement quadratic.
    #head = 0;
    // The read which was asked for last, which the next waits behind.
    #tail: Promise<unknown> = Promise.resolve();
    #starting: Promise<AsyncIterator<QueryChunk<unknown>> | undefined> | undefined;
    #iterator: AsyncIterator<QueryChunk<unknown>> | undefined;
    #source: ChunkSource | undefined;
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

    /**
     * Called once when the query has run out of chunks, for a view which held some back.
     */
    protected finish(_emit: (value: T) => void): void {}

    next(): Promise<IteratorResult<T>> {
        const read = this.#tail.then(() => this.#read());

        // Whatever a read ends in, the one behind it goes on to find out for itself.
        this.#tail = read.then(
            () => undefined,
            () => undefined,
        );

        return read;
    }

    async #read(): Promise<IteratorResult<T>> {
        for (;;) {
            if (this.#head < this.#queue.length) {
                const value = this.#queue[this.#head++] as T;

                // Dropped once it is all read, so what has been handed out is not held.
                if (this.#head === this.#queue.length) {
                    this.#queue = [];
                    this.#head = 0;
                }

                return { value, done: false };
            }

            // Once what came before it has been read.
            if (this.#failure) {
                const { error } = this.#failure;

                this.#failure = undefined;
                throw error;
            }

            if (this.#closed) return { value: undefined, done: true };

            let iterator: AsyncIterator<QueryChunk<unknown>> | undefined;

            try {
                iterator = await this.#start();
            } catch (error) {
                // The first read tells of it, and the view is over: later reads are not left to
                // find the same failure again.
                await this.#close();
                throw error;
            }

            // Left while it was starting: there is nothing to read, and nobody to read it.
            if (!iterator || this.#closed) return { value: undefined, done: true };

            let result: IteratorResult<QueryChunk<unknown>>;

            try {
                result = await iterator.next();
            } catch (error) {
                // A read which was parked when the view was left fails because the request was
                // abandoned, which is the reader leaving and nothing it is to be told of.
                if (this.#closed) return { value: undefined, done: true };

                await this.#close();
                throw error;
            }

            // Left while the read was parked. Whatever came back is for nobody.
            if (this.#closed) return { value: undefined, done: true };

            try {
                if (result.done) {
                    this.finish((item) => {
                        this.#queue.push(item);
                    });
                } else {
                    this.accept(result.value, (item) => {
                        this.#queue.push(item);
                    });
                }
            } catch (error) {
                // Stops the query at once, but what was produced before the failure in this chunk
                // is read first: the failure belongs after it, not in place of it.
                this.#failure = { error };
            }

            if (result.done || this.#failure) await this.#close();
        }
    }

    async return(): Promise<IteratorResult<T>> {
        this.#queue = [];
        this.#head = 0;
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

            let iterator: AsyncIterator<QueryChunk<unknown>>;

            try {
                iterator = source.chunks[Symbol.asyncIterator]();
            } catch (error) {
                source.dispose();
                throw error;
            }

            this.#source = source;
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

    /** Abandons the request, stops the query, then lets go of what the request holds. Once. */
    async #release(): Promise<void> {
        const iterator = this.#iterator;
        const source = this.#source;

        this.#iterator = undefined;
        this.#source = undefined;

        try {
            // Abandoned first, which fails a read parked on an answer which is not coming and, for
            // a stream, is what tells the server to stop.
            source?.abort();

            const returned = iterator?.return?.();

            // Not waited out. A source which is not streaming is parked for as long as its query
            // runs, and returning it settles only when that does; what matters - that the server
            // is told - has been done by now. A tick is allowed for a source which settles at once.
            returned?.catch(() => {});

            await Promise.race([returned, new Promise<void>((resolve) => setTimeout(resolve, 0))]);
        } finally {
            source?.dispose();
        }
    }
}

/**
 * The rows of a streamed query, as they arrive.
 *
 * For a query of several statements these are the rows of each in turn, in statement order, as
 * `collect()` returns them. A statement which is one bare value - `SELECT ... FROM ONLY`,
 * `RETURN 1 + 2` - is one row; one whose value is `NONE`, such as `LET`, is none.
 *
 * Statement order is kept even where the server does not produce it. Inside a `BEGIN ... COMMIT`
 * written in the query, the server sends the value of a statement after the rows of statements
 * which follow it, so those rows wait for the statement ahead of them to finish. Nowhere else is
 * anything held back: a query without one delivers every row as it arrives.
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

    // The lowest statement which has not finished: the one whose rows are the next to be delivered.
    #front = 0;
    readonly #finished = new Set<number>();
    // Rows of statements which are ahead of one which is still running, waiting their turn.
    readonly #held = new Map<number, unknown[]>();

    constructor(open: () => Promise<ChunkSource>, json: boolean, parse?: (row: never) => T) {
        super(open);
        this.#json = json;
        this.#parse = parse;
    }

    protected override accept(chunk: QueryChunk<unknown>, emit: (value: T) => void): void {
        if (chunk.error) throw chunk.error;

        const index = chunk.query;
        const value = chunk.result?.[0];
        const rows = chunk.kind === "single" ? (value === undefined ? [] : [value]) : chunk.result;

        if (index === this.#front) {
            for (const row of rows ?? []) emit(this.#row(row));
        } else if (rows?.length) {
            let held = this.#held.get(index);

            if (!held) {
                held = [];
                this.#held.set(index, held);
            }

            for (const row of rows) held.push(row);
        }

        // A single value, or the last of a list, is the end of the statement.
        if (chunk.kind === "batched") return;

        this.#finished.add(index);

        // What was waiting on it is next, and may itself be finished already.
        while (this.#finished.has(this.#front)) {
            this.#front++;
            this.#flush(this.#front, emit);
        }
    }

    protected override finish(emit: (value: T) => void): void {
        // Nothing is going to finish what is still held - a statement which never did, as one
        // does not once a block returns early - so it is delivered, in order, now.
        for (const index of [...this.#held.keys()].sort((a, b) => a - b)) {
            this.#flush(index, emit);
        }
    }

    #flush(index: number, emit: (value: T) => void): void {
        const held = this.#held.get(index);

        if (!held) return;

        this.#held.delete(index);

        for (const row of held) emit(this.#row(row));
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
 * yielded is never retracted by the statement failing afterwards. They are yielded in the order they
 * finish, which is statement order wherever the server runs them in turn; `index` says which each
 * is. A statement which fails throws its error and ends the iteration.
 *
 * A stream which fails as a whole after yielding - the connection being lost, say - still throws,
 * and a statement which registered a live query can be told after the fact that it was discarded.
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
