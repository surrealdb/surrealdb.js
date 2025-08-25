import type { QueryStats } from "../types";
import type { MaybeJsonify } from "./maybe-jsonify";

/**
 * Represents a single query result frame frame
 */
export class Frame<T, J extends boolean> {
    query: number;

    constructor(query: number) {
        this.query = query;
    }

    /**
     * Returns true if the frame is a value frame and optionally matches the query index
     */
    isValue<V = T>(query?: number): this is ValueFrame<V, J> {
        return this instanceof ValueFrame && (query === undefined || this.query === query);
    }

    /**
     * Returns true if the frame is an error frame and optionally matches the query index
     */
    isError<V = T>(query?: number): this is ErrorFrame<V, J> {
        return this instanceof ErrorFrame && (query === undefined || this.query === query);
    }

    /**
     * Returns true if the frame is a done frame and optionally matches the query index
     */
    isDone<V = T>(query?: number): this is DoneFrame<V, J> {
        return this instanceof DoneFrame && (query === undefined || this.query === query);
    }
}

/**
 * Represents a value frame in a query result
 */
export class ValueFrame<T, J extends boolean> extends Frame<T, J> {
    value: MaybeJsonify<T, J>;

    constructor(query: number, value: MaybeJsonify<T, J>) {
        super(query);
        this.value = value;
    }
}

/**
 * Represents an error frame in a query result
 */
export class ErrorFrame<T, J extends boolean> extends Frame<T, J> {
    stats: QueryStats | undefined;
    error: {
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
}

/**
 * Represents a done frame in a query result
 */
export class DoneFrame<T, J extends boolean> extends Frame<T, J> {
    stats: QueryStats | undefined;

    constructor(query: number, stats: QueryStats | undefined) {
        super(query);
        this.stats = stats;
    }
}
