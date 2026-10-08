import { JsonCodec } from "../codec/json/codec.ts";
import { getRangeJoin } from "../internal/range.ts";
import { equals } from "../utils/equals.ts";
import { escapeRangeBound } from "../utils/escape.ts";
import type { Bound } from "../utils/range.ts";
import { hasSymbol, markSymbol, RANGE_SYMBOL } from "../utils/symbols.ts";
import { Value } from "./value.ts";

/**
 * A SurrealQL range value.
 */
export class Range<Beg, End> extends Value {
    static override [Symbol.hasInstance](instance: unknown): boolean {
        return hasSymbol(instance, RANGE_SYMBOL);
    }

    private readonly _beg: Bound<Beg>;
    private readonly _end: Bound<End>;

    constructor(beg: Bound<Beg>, end: Bound<End>) {
        super();
        this._beg = beg;
        this._end = end;
        markSymbol(this, RANGE_SYMBOL);
    }

    equals(other: unknown): boolean {
        if (!(other instanceof Range)) return false;
        if (this._beg?.constructor !== other._beg?.constructor) return false;
        if (this._end?.constructor !== other._end?.constructor) return false;

        return (
            equals(this._beg?.value, other._beg?.value) &&
            equals(this._end?.value, other._end?.value)
        );
    }

    toJSON(): unknown {
        if (Value._useExperimentalToJson) {
            return JsonCodec.DEFAULT.encode(this);
        }
        return this.toString();
    }

    /**
     * @returns The escaped range string
     */
    toString(): string {
        const beg = escapeRangeBound(this._beg);
        const end = escapeRangeBound(this._end);
        return `${beg}${getRangeJoin(this._beg, this._end)}${end}`;
    }

    /**
     * The range bound beginning
     */
    get begin(): Bound<Beg> {
        return this._beg;
    }

    /**
     * The range bound ending
     */
    get end(): Bound<End> {
        return this._end;
    }
}
