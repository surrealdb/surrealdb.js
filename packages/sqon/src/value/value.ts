import { hasSymbol, markSymbol, VALUE_SYMBOL } from "../utils/symbols.ts";

/**
 * A complex SurrealQL value type
 */
export abstract class Value {
    protected static _useExperimentalToJson = false;

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

    /**
     * Enable the new experimental toJSON implementation.
     *
     * When enabled, the `toJSON` method will return values encoded by the `JsonCodec` resulting in a type-safe JSON representation.
     */
    static useExperimentalToJson(enabled?: boolean) {
        Value._useExperimentalToJson = enabled ?? true;
    }
}
