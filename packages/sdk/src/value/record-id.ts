import { SurrealError } from "../errors";
import { isValidIdPart, isValidTable } from "../internal/validation";
import { equals } from "../utils/equals";
import { escapeIdent, escapeIdPart } from "../utils/escape";
import { Table } from "./table";
import type { Uuid } from "./uuid";
import { Value } from "./value";

export type RecordIdValue = string | number | Uuid | bigint | unknown[] | Record<string, unknown>;

/**
 * A SurrealQL record ID value.
 */
export class RecordId<Tb extends string = string> extends Value {
    public readonly table: Table<Tb>;
    public readonly id: RecordIdValue;

    constructor(table: Tb | Table<Tb>, id: RecordIdValue) {
        super();

        if (!isValidTable(table)) throw new SurrealError("tb part is not valid");
        if (!isValidIdPart(id)) throw new SurrealError("id part is not valid");

        this.table = table instanceof Table ? table : new Table(table);
        this.id = id;
    }

    equals(other: unknown): boolean {
        if (!(other instanceof RecordId)) return false;
        return this.table.equals(other.table) && equals(this.id, other.id);
    }

    toJSON(): string {
        return this.toString();
    }

    toString(): string {
        const tb = escapeIdent(this.table.name);
        const id = escapeIdPart(this.id);
        return `${tb}:${id}`;
    }
}
