import { type Bound, BoundExcluded, BoundIncluded } from "../utils/range";
import { isBoundExcluded, isBoundIncluded } from "../utils/symbols";

export function getRangeJoin(beg: Bound<unknown>, end: Bound<unknown>): string {
    let output = "";
    if (isBoundExcluded(beg)) output += ">";
    output += "..";
    if (isBoundIncluded(end)) output += "=";
    return output;
}
