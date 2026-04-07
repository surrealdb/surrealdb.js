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

    readonly #table: Table<Tb>;
    readonly #beg: Bound<Id>;
    readonly #end: Bound<Id>;

    constructor(table: Tb | Table<Tb>, beg: Bound<Id>, end: Bound<Id>) {
        super();

        if (!isValidTable(table)) throw new InvalidRecordIdError("Table part is not valid");
        if (!isValidIdBound(beg)) throw new InvalidRecordIdError("Begin bound is not valid");
        if (!isValidIdBound(end)) throw new InvalidRecordIdError("End bound is not valid");

        this.#table = table instanceof Table ? table : new Table(table);
        this.#beg = beg;
        this.#end = end;
        markSymbol(this, RECORD_ID_RANGE_SYMBOL);
    }

    equals(other: unknown): boolean {
        if (!(other instanceof RecordIdRange)) return false;
        if (this.#beg?.constructor !== other.#beg?.constructor) return false;
        if (this.#end?.constructor !== other.#end?.constructor) return false;

        return (
            this.#table.equals(other.#table) &&
            equals(this.#beg?.value, other.#beg?.value) &&
            equals(this.#end?.value, other.#end?.value)
        );
    }

    toJSON(): unknown {
        if (Value._useExperimentalToJson) {
            return JsonCodec.DEFAULT.encode(this);
        }
        return this.toString();
    }

    toString(): string {
        const tb = escapeIdent(this.#table.name);
        const beg = escapeRangeBound(this.#beg);
        const end = escapeRangeBound(this.#end);
        return `${tb}:${beg}${getRangeJoin(this.#beg, this.#end)}${end}`;
    }

    get table(): Table<Tb> {
        return this.#table;
    }

    get begin(): Bound<Id> {
        return this.#beg;
    }

    get end(): Bound<Id> {
        return this.#end;
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

type _RecordIdRange<
    Tb extends string = string,
    Id extends RecordIdValue = RecordIdValue,
> = RecordIdRange<Tb, Id>;
const _RecordIdRange = RecordIdRange as unknown as RecordIdRangeConstructor;

export { _RecordIdRange as RecordIdRange };
