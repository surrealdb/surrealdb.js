import { Tagged } from "@surrealdb/cbor";
import { SqonError } from "../../errors.ts";
import type { Bound, BoundExcluded, BoundIncluded } from "../../utils/range.ts";
import { BOUND_EXCLUDED_SYMBOL, BOUND_INCLUDED_SYMBOL, hasSymbol } from "../../utils/symbols.ts";
import { TAG_BOUND_EXCLUDED, TAG_BOUND_INCLUDED } from "./codec.ts";

type DecodedBound = BoundIncluded<unknown> | BoundExcluded<unknown> | null;

export function rangeToCbor([beg, end]: [Bound<unknown>, Bound<unknown>]): [
    Tagged | null,
    Tagged | null,
] {
    function encodeBound(bound: Bound<unknown>): Tagged | null {
        if (!bound) return null;
        if (hasSymbol(bound, BOUND_INCLUDED_SYMBOL))
            return new Tagged(TAG_BOUND_INCLUDED, bound.value);
        if (hasSymbol(bound, BOUND_EXCLUDED_SYMBOL))
            return new Tagged(TAG_BOUND_EXCLUDED, bound.value);
        return null;
    }

    return [encodeBound(beg), encodeBound(end)];
}

export function cborToRange(
    range: [DecodedBound | null, DecodedBound | null],
): [Bound<unknown>, Bound<unknown>] {
    function decodeBound(bound: DecodedBound | null): Bound<unknown> {
        if (bound === null) return undefined;
        if (hasSymbol(bound, BOUND_INCLUDED_SYMBOL)) return bound;
        if (hasSymbol(bound, BOUND_EXCLUDED_SYMBOL)) return bound;
        throw new SqonError("Expected the bounds to be decoded already");
    }

    return [decodeBound(range[0]), decodeBound(range[1])];
}
