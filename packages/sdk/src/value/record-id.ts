import { Value } from "./value";
import type { Uuid } from "./uuid";
import { SurrealError } from "../errors";
import { equals } from "../utils/equals";
import { escapeIdent, escapeIdPart } from "../utils/escape";
import { isValidIdPart, isValidTable } from "../internal/validation";
import { Table } from "./table";

export type RecordIdValue =
	| string
	| number
	| Uuid
	| bigint
	| unknown[]
	| Record<string, unknown>;

/**
 * A SurrealQL record ID value.
 */
export class RecordId<Tb extends string = string> extends Value {
	public readonly tb: Tb;
	public readonly id: RecordIdValue;

	constructor(tb: Tb | Table, id: RecordIdValue) {
		super();

		if (!isValidTable(tb)) throw new SurrealError("tb part is not valid");
		if (!isValidIdPart(id)) throw new SurrealError("id part is not valid");

		this.tb = tb instanceof Table ? (tb.tb as Tb) : tb;
		this.id = id;
	}

	get table(): Table {
		return new Table(this.tb);
	}

	equals(other: unknown): boolean {
		if (!(other instanceof RecordId)) return false;
		return this.tb === other.tb && equals(this.id, other.id);
	}

	toJSON(): string {
		return this.toString();
	}

	toString(): string {
		const tb = escapeIdent(this.tb);
		const id = escapeIdPart(this.id);
		return `${tb}:${id}`;
	}
}
