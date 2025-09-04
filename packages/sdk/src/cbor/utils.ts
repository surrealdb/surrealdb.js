import { Tagged } from "@surrealdb/cbor";
import { SurrealError } from "../errors";
import { type Bound, BoundExcluded, BoundIncluded } from "../utils/range";
import { TAG_BOUND_EXCLUDED, TAG_BOUND_INCLUDED } from "./replacer";

type DecodedBound = BoundIncluded<unknown> | BoundExcluded<unknown> | null;

export function rangeToCbor([beg, end]: [Bound<unknown>, Bound<unknown>]): [
    Tagged | null,
    Tagged | null,
] {
    function encodeBound(bound: Bound<unknown>): Tagged | null {
        if (bound instanceof BoundIncluded) return new Tagged(TAG_BOUND_INCLUDED, bound.value);
        if (bound instanceof BoundExcluded) return new Tagged(TAG_BOUND_EXCLUDED, bound.value);
        return null;
    }

    return [encodeBound(beg), encodeBound(end)];
}

export function cborToRange(
    range: [DecodedBound | null, DecodedBound | null],
): [Bound<unknown>, Bound<unknown>] {
    function decodeBound(bound: DecodedBound | null): Bound<unknown> {
        if (bound === null) return undefined;
        if (bound instanceof BoundIncluded) return bound;
        if (bound instanceof BoundExcluded) return bound;
        throw new SurrealError("Expected the bounds to be decoded already");
    }

    return [decodeBound(range[0]), decodeBound(range[1])];
}
