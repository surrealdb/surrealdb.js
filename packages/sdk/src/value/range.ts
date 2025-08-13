import { getRangeJoin } from "../internal/range";
import { equals } from "../utils/equals";
import { escapeRangeBound } from "../utils/escape";
import type { Bound } from "../utils/range";
import { Value } from "./value";

/**
 * A SurrealQL range value.
 */
export class Range<Beg, End> extends Value {
    public readonly beg: Bound<Beg>;
    public readonly end: Bound<End>;

    constructor(beg: Bound<Beg>, end: Bound<End>) {
        super();
        this.beg = beg;
        this.end = end;
    }

    equals(other: unknown): boolean {
        if (!(other instanceof Range)) return false;
        if (this.beg?.constructor !== other.beg?.constructor) return false;
        if (this.end?.constructor !== other.end?.constructor) return false;

        return (
            equals(this.beg?.value, other.beg?.value) && equals(this.end?.value, other.end?.value)
        );
    }

    toJSON(): string {
        return this.toString();
    }

    toString(): string {
        const beg = escapeRangeBound(this.beg);
        const end = escapeRangeBound(this.end);
        return `${beg}${getRangeJoin(this.beg, this.end)}${end}`;
    }
}
