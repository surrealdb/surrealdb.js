import { SurrealError } from "../errors";
import { getRangeJoin } from "../internal/range";
import { isValidIdBound, isValidTable } from "../internal/validation";
import { equals } from "../utils/equals";
import { escapeIdent, escapeRangeBound } from "../utils/escape";
import type { Bound } from "../utils/range";
import type { RecordIdValue } from "./record-id";
import { Table } from "./table";
import { Value } from "./value";

/**
 * A SurrealQL record ID range value.
 */
export class RecordIdRange<Tb extends string = string> extends Value {
    public readonly table: Table<Tb>;
    public readonly beg: Bound<RecordIdValue>;
    public readonly end: Bound<RecordIdValue>;

    constructor(table: Tb | Table<Tb>, beg: Bound<RecordIdValue>, end: Bound<RecordIdValue>) {
        super();

        if (!isValidTable(table)) throw new SurrealError("tb part is not valid");
        if (!isValidIdBound(beg)) throw new SurrealError("Begin part is not valid");
        if (!isValidIdBound(end)) throw new SurrealError("End part is not valid");

        this.table = table instanceof Table ? table : new Table(table);
        this.beg = beg;
        this.end = end;
    }

    equals(other: unknown): boolean {
        if (!(other instanceof RecordIdRange)) return false;
        if (this.beg?.constructor !== other.beg?.constructor) return false;
        if (this.end?.constructor !== other.end?.constructor) return false;

        return (
            this.table.equals(other.table) &&
            equals(this.beg?.value, other.beg?.value) &&
            equals(this.end?.value, other.end?.value)
        );
    }

    toJSON(): string {
        return this.toString();
    }

    toString(): string {
        const tb = escapeIdent(this.table.name);
        const beg = escapeRangeBound(this.beg);
        const end = escapeRangeBound(this.end);
        return `${tb}:${beg}${getRangeJoin(this.beg, this.end)}${end}`;
    }
}
