import { BOUND_EXCLUDED_SYMBOL, BOUND_INCLUDED_SYMBOL, hasSymbol, markSymbol } from "./symbols";

/**
 * Represents a range bound which includes the value within the range
 */
export class BoundIncluded<T> {
    static [Symbol.hasInstance](instance: unknown): boolean {
        return hasSymbol(instance, BOUND_INCLUDED_SYMBOL);
    }

    constructor(readonly value: T) {
        markSymbol(this, BOUND_INCLUDED_SYMBOL);
    }
}

/**
 * Represents a range bound which excludes the value from the range
 */
export class BoundExcluded<T> {
    static [Symbol.hasInstance](instance: unknown): boolean {
        return hasSymbol(instance, BOUND_EXCLUDED_SYMBOL);
    }

    constructor(readonly value: T) {
        markSymbol(this, BOUND_EXCLUDED_SYMBOL);
    }
}

/**
 * Represents a Bound which can represent the start or end of a range
 */
export type Bound<T> = BoundIncluded<T> | BoundExcluded<T> | undefined;
