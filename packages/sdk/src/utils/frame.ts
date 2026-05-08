import type { ServerError } from "../errors";
import type { MaybeJsonify } from "../internal/maybe-jsonify";
import type { QueryStats, QueryType } from "../types";
import {
    DONE_FRAME_SYMBOL,
    ERROR_FRAME_SYMBOL,
    FRAME_SYMBOL,
    hasSymbol,
    markSymbol,
    VALUE_FRAME_SYMBOL,
} from "../utils/symbols";

/**
 * Represents a single query result frame frame
 */
export class Frame<T, J extends boolean> {
    static [Symbol.hasInstance](instance: unknown): boolean {
        return hasSymbol(instance, FRAME_SYMBOL);
    }

    readonly query: number;

    constructor(query: number) {
        this.query = query;
        markSymbol(this, FRAME_SYMBOL);
    }

    /**
     * Returns true if the frame is associated with the given query index
     */
    isOf<V = T>(query: number): this is Frame<V, J> {
        return this.query === query;
    }

    /**
     * Returns true if the frame is a value frame
     */
    isValue(): this is ValueFrame<T, J> {
        return this instanceof ValueFrame;
    }

    /**
     * Returns true if the frame is an error frame
     */
    isError(): this is ErrorFrame<T, J> {
        return this instanceof ErrorFrame;
    }

    /**
     * Returns true if the frame is a done frame
     */
    isDone(): this is DoneFrame<T, J> {
        return this instanceof DoneFrame;
    }

    /**
     * Returns true if the frame is a value frame and associated with the given query index
     */
    isValueOf<V = T>(query: number): this is ValueFrame<V, J> {
        return this.isOf(query) && this.isValue();
    }

    /**
     * Returns true if the frame is an error frame and associated with the given query index
     */
    isErrorOf<V = T>(query: number): this is ErrorFrame<V, J> {
        return this.isOf(query) && this.isError();
    }

    /**
     * Returns true if the frame is a done frame and associated with the given query index
     */
    isDoneOf<V = T>(query: number): this is DoneFrame<V, J> {
        return this.isOf(query) && this.isDone();
    }
}

/**
 * Represents a value frame in a query result. If `isSingle` is true, the frame represents a single value
 * and no further values will be returned for that specific statement.
 */
export class ValueFrame<T, J extends boolean> extends Frame<T, J> {
    static override [Symbol.hasInstance](instance: unknown): boolean {
        return hasSymbol(instance, VALUE_FRAME_SYMBOL);
    }

    readonly value: MaybeJsonify<T, J>;
    readonly isSingle: boolean;

    constructor(query: number, value: MaybeJsonify<T, J>, isSingle: boolean) {
        super(query);
        this.value = value;
        this.isSingle = isSingle;
        markSymbol(this, VALUE_FRAME_SYMBOL);
    }

    override isOf<V = T>(query: number): this is ValueFrame<V, J> {
        return super.isOf(query);
    }
}

/**
 * Represents an error frame in a query result
 */
export class ErrorFrame<T, J extends boolean> extends Frame<T, J> {
    static override [Symbol.hasInstance](instance: unknown): boolean {
        return hasSymbol(instance, ERROR_FRAME_SYMBOL);
    }

    readonly stats: QueryStats | undefined;
    readonly error: ServerError;

    constructor(query: number, stats: QueryStats | undefined, error: ServerError) {
        super(query);
        this.stats = stats;
        this.error = error;
        markSymbol(this, ERROR_FRAME_SYMBOL);
    }

    override isOf<V = T>(query: number): this is ErrorFrame<V, J> {
        return super.isOf(query);
    }

    /**
     * Throw the server error corresponding to this error frame
     */
    throw(): never {
        throw this.error;
    }
}

/**
 * Represents a done frame in a query result
 */
export class DoneFrame<T, J extends boolean> extends Frame<T, J> {
    static override [Symbol.hasInstance](instance: unknown): boolean {
        return hasSymbol(instance, DONE_FRAME_SYMBOL);
    }

    readonly stats: QueryStats | undefined;
    readonly type: QueryType;

    constructor(query: number, stats: QueryStats | undefined, type: QueryType) {
        super(query);
        this.stats = stats;
        this.type = type;
        markSymbol(this, DONE_FRAME_SYMBOL);
    }

    override isOf<V = T>(query: number): this is DoneFrame<V, J> {
        return super.isOf(query);
    }
}
