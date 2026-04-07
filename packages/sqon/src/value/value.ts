import { hasSymbol, markSymbol, VALUE_SYMBOL } from "../utils/symbols.ts";

/**
 * A complex SurrealQL value type
 */
export abstract class Value {
    static useExperimentalToJson = false;

    static [Symbol.hasInstance](instance: unknown): boolean {
        return hasSymbol(instance, VALUE_SYMBOL);
    }

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
