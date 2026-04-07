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
 * @internal
 */
class RecordId<Tb extends string = string, Id extends RecordIdValue = RecordIdValue> extends Value {
    static override [Symbol.hasInstance](instance: unknown): boolean {
        return hasSymbol(instance, RECORD_ID_SYMBOL);
    }

    readonly #table: Table<Tb>;
    readonly #id: Id;

    constructor(table: Tb | Table<Tb>, id: Id) {
        super();

        if (!isValidTable(table)) throw new InvalidRecordIdError("Table part is not valid");
        if (!isValidIdPart(id)) throw new InvalidRecordIdError("ID part is not valid");

        this.#table = table instanceof Table ? table : new Table(table);
        this.#id = id;
        markSymbol(this, RECORD_ID_SYMBOL);
    }

    equals(other: unknown): boolean {
        if (!(other instanceof RecordId)) return false;
        return this.#table.equals(other.#table) && equals(this.#id, other.#id);
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
        const tb = escapeIdent(this.#table.name);
        const id = escapeIdPart(this.#id);
        return `${tb}:${id}`;
    }

    get table(): Table<Tb> {
        return this.#table;
    }

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

type _RecordId<Tb extends string = string, Id extends RecordIdValue = RecordIdValue> = RecordId<
    Tb,
    Id
>;
const _RecordId = RecordId as RecordIdConstructor;

export { _RecordId as RecordId };
