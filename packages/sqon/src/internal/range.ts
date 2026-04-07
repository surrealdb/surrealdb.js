import { type Bound, BoundExcluded, BoundIncluded } from "../utils/range.ts";

export function getRangeJoin(beg: Bound<unknown>, end: Bound<unknown>): string {
    let output = "";
    if (beg instanceof BoundExcluded) output += ">";
    output += "..";
    if (end instanceof BoundIncluded) output += "=";
    return output;
}
