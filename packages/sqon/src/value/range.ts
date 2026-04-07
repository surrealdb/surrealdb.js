import { getRangeJoin } from "../internal/range.ts";
import { JsonCodec } from "../json/codec.ts";
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

    readonly #beg: Bound<Beg>;
    readonly #end: Bound<End>;

    constructor(beg: Bound<Beg>, end: Bound<End>) {
        super();
        this.#beg = beg;
        this.#end = end;
        markSymbol(this, RANGE_SYMBOL);
    }

    equals(other: unknown): boolean {
        if (!(other instanceof Range)) return false;
        if (this.#beg?.constructor !== other.#beg?.constructor) return false;
        if (this.#end?.constructor !== other.#end?.constructor) return false;

        return (
            equals(this.#beg?.value, other.#beg?.value) &&
            equals(this.#end?.value, other.#end?.value)
        );
    }

    toJSON(): unknown {
        if (Value.useExperimentalToJson) {
            return JsonCodec.default.encode(this);
        }
        return this.toString();
    }

    /**
     * @returns The escaped range string
     */
    toString(): string {
        const beg = escapeRangeBound(this.#beg);
        const end = escapeRangeBound(this.#end);
        return `${beg}${getRangeJoin(this.#beg, this.#end)}${end}`;
    }

    get begin(): Bound<Beg> {
        return this.#beg;
    }

    get end(): Bound<End> {
        return this.#end;
    }
}
