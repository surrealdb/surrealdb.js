import { JsonCodec } from "../codec/json/codec.ts";
import { InvalidRecordIdError } from "../errors.ts";
import { isValidIdPart, isValidTable } from "../internal/validation.ts";
import type { WidenRecordIdValue } from "../types/internal.ts";
import { equals } from "../utils/equals.ts";
import { escapeIdent, escapeIdPart } from "../utils/escape.ts";
import { hasSymbol, markSymbol, RECORD_ID_SYMBOL } from "../utils/symbols.ts";
import { Table } from "./table.ts";
import type { Uuid } from "./uuid.ts";
import { Value } from "./value.ts";

export type RecordIdValue = string | number | Uuid | bigint | unknown[] | Record<string, unknown>;

/**
 * A SurrealQL record ID value.
 *
 * @typeParam Tb The table name, as a string literal type
 * @typeParam Id The type of the ID part
 * @typeParam T The type of the records in the table. This is a compile-time annotation only, taken
 * from the `Table` the record ID was created from. It is not validated against the data returned
 * by the server.
 *
 * @internal
 */
class RecordId<
    Tb extends string = string,
    Id extends RecordIdValue = RecordIdValue,
    T = unknown,
> extends Value {
    static override [Symbol.hasInstance](instance: unknown): boolean {
        return hasSymbol(instance, RECORD_ID_SYMBOL);
    }

    private readonly _table: Table<Tb, T>;
    private readonly _id: Id;

    constructor(table: Tb | Table<Tb, T>, id: Id) {
        super();

        if (!isValidTable(table)) throw new InvalidRecordIdError("Table part is not valid");
        if (!isValidIdPart(id)) throw new InvalidRecordIdError("ID part is not valid");

        this._table = typeof table === "string" ? new Table<Tb, T>(table) : table;
        this._id = id;
        markSymbol(this, RECORD_ID_SYMBOL);
    }

    equals(other: unknown): boolean {
        if (!(other instanceof RecordId)) return false;
        return this._table.equals(other._table) && equals(this._id, other._id);
    }

    toJSON(): unknown {
        if (Value._useExperimentalToJson) {
            return JsonCodec.DEFAULT.encode(this);
        }
        return this.toString();
    }

    /**
     * @returns The escaped record ID string including the table name
     */
    toString(): string {
        const tb = escapeIdent(this._table.name);
        const id = escapeIdPart(this._id);
        return `${tb}:${id}`;
    }

    /**
     * The table part value
     */
    get table(): Table<Tb, T> {
        return this._table;
    }

    /**
     * The ID part value
     */
    get id(): Id {
        return this._id;
    }
}

interface RecordIdConstructor {
    new <Tb extends string = string, I extends RecordIdValue = RecordIdValue, T = unknown>(
        table: Tb | Table<Tb, T>,
        id: I,
    ): RecordId<Tb, WidenRecordIdValue<I>, T>;
    new <R extends RecordId<string, RecordIdValue>>(
        table: R["table"]["name"],
        id: R["id"],
    ): RecordId<R["table"]["name"], R["id"]>;
}

/**
 * A SurrealQL record ID value.
 */
type _RecordId<
    Tb extends string = string,
    Id extends RecordIdValue = RecordIdValue,
    T = unknown,
> = RecordId<Tb, Id, T>;
const _RecordId = RecordId as RecordIdConstructor;

export { _RecordId as RecordId };
