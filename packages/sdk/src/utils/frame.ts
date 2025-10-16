import { ResponseError } from "../errors";
import type { MaybeJsonify } from "../internal/maybe-jsonify";
import type { QueryStats, QueryType } from "../types";

/**
 * Represents a single query result frame frame
 */
export class Frame<T, J extends boolean> {
    readonly query: number;

    constructor(query: number) {
        this.query = query;
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
    isValue<V = T>(): this is ValueFrame<V, J> {
        return this instanceof ValueFrame;
    }

    /**
     * Returns true if the frame is an error frame
     */
    isError<V = T>(): this is ErrorFrame<V, J> {
        return this instanceof ErrorFrame;
    }

    /**
     * Returns true if the frame is a done frame
     */
    isDone<V = T>(): this is DoneFrame<V, J> {
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
    readonly value: MaybeJsonify<T, J>;
    readonly isSingle: boolean;

    constructor(query: number, value: MaybeJsonify<T, J>, isSingle: boolean) {
        super(query);
        this.value = value;
        this.isSingle = isSingle;
    }

    override isOf<V = T>(query: number): this is ValueFrame<V, J> {
        return super.isOf(query);
    }
}

/**
 * Represents an error frame in a query result
 */
export class ErrorFrame<T, J extends boolean> extends Frame<T, J> {
    readonly stats: QueryStats | undefined;
    readonly error: {
        code: number;
        message: string;
    };

    constructor(
        query: number,
        stats: QueryStats | undefined,
        error: { code: number; message: string },
    ) {
        super(query);
        this.stats = stats;
        this.error = error;
    }

    override isOf<V = T>(query: number): this is ErrorFrame<V, J> {
        return super.isOf(query);
    }

    /**
     * Throw an error corresponding to this error frame
     */
    throw(): never {
        throw new ResponseError(this.error);
    }
}

/**
 * Represents a done frame in a query result
 */
export class DoneFrame<T, J extends boolean> extends Frame<T, J> {
    readonly stats: QueryStats | undefined;
    readonly type: QueryType;

    constructor(query: number, stats: QueryStats | undefined, type: QueryType) {
        super(query);
        this.stats = stats;
        this.type = type;
    }

    override isOf<V = T>(query: number): this is DoneFrame<V, J> {
        return super.isOf(query);
    }
}
