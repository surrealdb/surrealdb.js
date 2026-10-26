import { Columns } from "./columnar.ts";
import type { Shape } from "./shape.ts";

/**
 * The shape which holds every row of `rows`, or `undefined` when they are not rows a block can
 * carry: an empty array, or one whose entries are not all plain objects.
 *
 * The server shapes rows it has not seen yet, so it fits each row to the shape in hand and
 * widens or re-announces when one does not fit. A client already holds the whole array, so it
 * reads every row once to learn the union of what they hold — which keys appear, which are ever
 * missing, `NULL` or `NONE`, and whether their kinds agree — and writes them all in one shape.
 * One SHAPE, one BATCH, no joining and no re-announcement.
 *
 * What no column can describe — a nested object, a ragged array, keys whose kinds disagree —
 * becomes a `dynamic` column holding one CBOR item. So a shape is always possible for an array
 * of objects; it just stops being worth sending when most of it is dynamic.
 *
 * That read is also what writing the rows needs, so the two share one pass: this hands back the
 * shape alone, for callers which only want to know what the rows look like.
 */
export function deriveShape(rows: readonly unknown[]): Shape | undefined {
    return Columns.collect(rows)?.shape;
}
