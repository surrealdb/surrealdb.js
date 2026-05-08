import { InvalidRecordIdError } from "../errors";
import { getRangeJoin } from "../internal/range";
import { isValidIdBound, isValidTable } from "../internal/validation";
import type { WidenRecordIdValue } from "../types/internal";
import { equals } from "../utils/equals";
import { escapeIdent, escapeRangeBound } from "../utils/escape";
import type { Bound } from "../utils/range";
import { hasSymbol, markSymbol, RECORD_ID_RANGE_SYMBOL } from "../utils/symbols";
import type { RecordIdValue } from "./record-id";
import { Table } from "./table";
import { Value } from "./value";

/**
 * A SurrealQL record ID range value.
 *
 * @internal
 */
class RecordIdRange<
    Tb extends string = string,
    Id extends RecordIdValue = RecordIdValue,
> extends Value {
    static override [Symbol.hasInstance](instance: unknown): boolean {
        return hasSymbol(instance, RECORD_ID_RANGE_SYMBOL);
    }

    readonly table: Table<Tb>;
    readonly begin: Bound<Id>;
    readonly end: Bound<Id>;

    constructor(table: Tb | Table<Tb>, beg: Bound<Id>, end: Bound<Id>) {
        super();

        if (!isValidTable(table)) throw new InvalidRecordIdError("Table part is not valid");
        if (!isValidIdBound(beg)) throw new InvalidRecordIdError("Begin bound is not valid");
        if (!isValidIdBound(end)) throw new InvalidRecordIdError("End bound is not valid");

        this.table =
            table instanceof Table ? (table as unknown as Table<Tb>) : new Table(table as Tb);
        this.begin = beg;
        this.end = end;
        markSymbol(this, RECORD_ID_RANGE_SYMBOL);
    }

    equals(other: unknown): boolean {
        if (!(other instanceof RecordIdRange)) return false;
        const o = other as unknown as RecordIdRange;
        if (this.begin?.constructor !== o.begin?.constructor) return false;
        if (this.end?.constructor !== o.end?.constructor) return false;

        return (
            this.table.equals(o.table) &&
            equals(this.begin?.value, o.begin?.value) &&
            equals(this.end?.value, o.end?.value)
        );
    }

    toJSON(): string {
        return this.toString();
    }

    /**
     * @returns The escaped record ID range string
     */
    toString(): string {
        const tb = escapeIdent(this.table.name);
        const beg = escapeRangeBound(this.begin);
        const end = escapeRangeBound(this.end);
        return `${tb}:${beg}${getRangeJoin(this.begin, this.end)}${end}`;
    }
}

interface RecordIdRangeConstructor {
    new <T extends string = string, I extends RecordIdValue = RecordIdValue>(
        table: T | Table<T>,
        beg: Bound<I>,
        end: Bound<I>,
    ): RecordIdRange<T, WidenRecordIdValue<I>>;
    new <R extends RecordIdRange<string, RecordIdValue>>(
        table: R["table"]["name"],
        beg: R["begin"],
        end: R["end"],
    ): RecordIdRange<
        R["table"]["name"],
        R["begin"] extends Bound<infer I> ? (I extends RecordIdValue ? I : never) : never
    >;
}

/**
 * A SurrealQL record ID range value.
 */
type _RecordIdRange<
    Tb extends string = string,
    Id extends RecordIdValue = RecordIdValue,
> = RecordIdRange<Tb, Id>;
const _RecordIdRange = RecordIdRange as RecordIdRangeConstructor;

export { _RecordIdRange as RecordIdRange };
