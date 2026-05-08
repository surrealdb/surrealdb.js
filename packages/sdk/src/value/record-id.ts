import { InvalidRecordIdError } from "../errors";
import { isValidIdPart, isValidTable } from "../internal/validation";
import type { WidenRecordIdValue } from "../types/internal";
import { equals } from "../utils/equals";
import { escapeIdent, escapeIdPart } from "../utils/escape";
import { hasSymbol, markSymbol, RECORD_ID_SYMBOL } from "../utils/symbols";
import { Table } from "./table";
import type { Uuid } from "./uuid";
import { Value } from "./value";

export type RecordIdValue = string | number | Uuid | bigint | unknown[] | Record<string, unknown>;

/**
 * A SurrealQL record ID value.
 *
 * @internal
 */
class RecordId<Tb extends string = string, Id extends RecordIdValue = RecordIdValue> extends Value {
    static override [Symbol.hasInstance](instance: unknown): boolean {
        return hasSymbol(instance, RECORD_ID_SYMBOL);
    }

    readonly table: Table<Tb>;
    readonly id: Id;

    constructor(table: Tb | Table<Tb>, id: Id) {
        super();

        if (!isValidTable(table)) throw new InvalidRecordIdError("Table part is not valid");
        if (!isValidIdPart(id)) throw new InvalidRecordIdError("ID part is not valid");

        this.table =
            table instanceof Table ? (table as unknown as Table<Tb>) : new Table(table as Tb);
        this.id = id;
        markSymbol(this, RECORD_ID_SYMBOL);
    }

    equals(other: unknown): boolean {
        if (!(other instanceof RecordId)) return false;
        const o = other as unknown as RecordId;
        return this.table.equals(o.table) && equals(this.id, o.id);
    }

    toJSON(): string {
        return this.toString();
    }

    /**
     * @returns The escaped record ID string including the table name
     */
    toString(): string {
        const tb = escapeIdent(this.table.name);
        const id = escapeIdPart(this.id);
        return `${tb}:${id}`;
    }
}

interface RecordIdConstructor {
    new <T extends string = string, I extends RecordIdValue = RecordIdValue>(
        table: T | Table<T>,
        id: I,
    ): RecordId<T, WidenRecordIdValue<I>>;
    new <R extends RecordId<string, RecordIdValue>>(
        table: R["table"]["name"],
        id: R["id"],
    ): RecordId<R["table"]["name"], R["id"]>;
}

/**
 * A SurrealQL record ID value.
 */
type _RecordId<Tb extends string = string, Id extends RecordIdValue = RecordIdValue> = RecordId<
    Tb,
    Id
>;
const _RecordId = RecordId as RecordIdConstructor;

export { _RecordId as RecordId };
