import { InvalidRecordIdError } from "../errors";
import { isValidIdPart, isValidTable } from "../internal/validation";
import type { WidenRecordIdValue } from "../types/internal";
import { equals } from "../utils/equals";
import { escapeIdent, escapeIdPart } from "../utils/escape";
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
    readonly #table: Table<Tb>;
    readonly #id: Id;

    constructor(table: Tb | Table<Tb>, id: Id) {
        super();

        if (!isValidTable(table)) throw new InvalidRecordIdError("Table part is not valid");
        if (!isValidIdPart(id)) throw new InvalidRecordIdError("ID part is not valid");

        this.#table = table instanceof Table ? table : new Table(table);
        this.#id = id;
    }

    equals(other: unknown): boolean {
        if (!(other instanceof RecordId)) return false;
        return this.#table.equals(other.#table) && equals(this.#id, other.#id);
    }

    toJSON(): string {
        return this.toString();
    }

    /**
     * @returns The escaped record ID string including the table name
     */
    toString(): string {
        const tb = escapeIdent(this.#table.name);
        const id = escapeIdPart(this.#id);
        return `${tb}:${id}`;
    }

    /**
     * The table part value
     */
    get table(): Table<Tb> {
        return this.#table;
    }

    /**
     * The ID part value
     */
    get id(): Id {
        return this.#id;
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
