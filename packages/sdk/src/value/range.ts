import { getRangeJoin } from "../internal/range";
import { equals } from "../utils/equals";
import { escapeRangeBound } from "../utils/escape";
import type { Bound } from "../utils/range";
import { hasSymbol, markSymbol, RANGE_SYMBOL } from "../utils/symbols";
import { Value } from "./value";

/**
 * A SurrealQL range value.
 */
export class Range<Beg, End> extends Value {
    static override [Symbol.hasInstance](instance: unknown): boolean {
        return hasSymbol(instance, RANGE_SYMBOL);
    }

    readonly begin: Bound<Beg>;
    readonly end: Bound<End>;

    constructor(beg: Bound<Beg>, end: Bound<End>) {
        super();
        this.begin = beg;
        this.end = end;
        markSymbol(this, RANGE_SYMBOL);
    }

    equals(other: unknown): boolean {
        if (!(other instanceof Range)) return false;
        const o = other as unknown as Range<unknown, unknown>;
        if (this.begin?.constructor !== o.begin?.constructor) return false;
        if (this.end?.constructor !== o.end?.constructor) return false;

        return equals(this.begin?.value, o.begin?.value) && equals(this.end?.value, o.end?.value);
    }

    toJSON(): string {
        return this.toString();
    }

    /**
     * @returns The escaped range string
     */
    toString(): string {
        const beg = escapeRangeBound(this.begin);
        const end = escapeRangeBound(this.end);
        return `${beg}${getRangeJoin(this.begin, this.end)}${end}`;
    }
}
