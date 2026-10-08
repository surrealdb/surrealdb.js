import { JsonCodec } from "../codec/json/codec.ts";
import { InvalidRecordIdError } from "../errors.ts";
import { getRangeJoin } from "../internal/range.ts";
import { isValidIdBound, isValidTable } from "../internal/validation.ts";
import type { WidenRecordIdValue } from "../types/internal.ts";
import { equals } from "../utils/equals.ts";
import { escapeIdent, escapeRangeBound } from "../utils/escape.ts";
import type { Bound } from "../utils/range.ts";
import { hasSymbol, markSymbol, RECORD_ID_RANGE_SYMBOL } from "../utils/symbols.ts";
import type { RecordIdValue } from "./record-id.ts";
import { Table } from "./table.ts";
import { Value } from "./value.ts";

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

    private readonly _table: Table<Tb>;
    private readonly _beg: Bound<Id>;
    private readonly _end: Bound<Id>;

    constructor(table: Tb | Table<Tb>, beg: Bound<Id>, end: Bound<Id>) {
        super();

        if (!isValidTable(table)) throw new InvalidRecordIdError("Table part is not valid");
        if (!isValidIdBound(beg)) throw new InvalidRecordIdError("Begin bound is not valid");
        if (!isValidIdBound(end)) throw new InvalidRecordIdError("End bound is not valid");

        this._table = table instanceof Table ? table : new Table(table);
        this._beg = beg;
        this._end = end;
        markSymbol(this, RECORD_ID_RANGE_SYMBOL);
    }

    equals(other: unknown): boolean {
        if (!(other instanceof RecordIdRange)) return false;
        if (this._beg?.constructor !== other._beg?.constructor) return false;
        if (this._end?.constructor !== other._end?.constructor) return false;

        return (
            this._table.equals(other._table) &&
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
     * @returns The escaped record ID range string
     */
    toString(): string {
        const tb = escapeIdent(this._table.name);
        const beg = escapeRangeBound(this._beg);
        const end = escapeRangeBound(this._end);
        return `${tb}:${beg}${getRangeJoin(this._beg, this._end)}${end}`;
    }

    /**
     * The table part value
     */
    get table(): Table<Tb> {
        return this._table;
    }

    /**
     * The range bound beginning
     */
    get begin(): Bound<Id> {
        return this._beg;
    }

    /**
     * The range bound ending
     */
    get end(): Bound<Id> {
        return this._end;
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
const _RecordIdRange = RecordIdRange as unknown as RecordIdRangeConstructor;

export { _RecordIdRange as RecordIdRange };
