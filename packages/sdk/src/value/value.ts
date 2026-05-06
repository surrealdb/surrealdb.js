import { markSymbol, VALUE_SYMBOL } from "../utils/symbols";

/**
 * A complex SurrealQL value type
 */
export abstract class Value {
    constructor() {
        markSymbol(this, VALUE_SYMBOL);
    }

    /**
     * Compare equality with another value.
     */
    abstract equals(other: unknown): boolean;

    /**
     * Convert this value to a serializable string
     */
    abstract toJSON(): unknown;

    /**
     * Convert this value to a string representation
     */
    abstract toString(): string;
}
