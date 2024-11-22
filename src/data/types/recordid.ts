import { SurrealDbError } from "../../errors";
import { equals } from "../../util/equals";
import { escapeIdent, escapeNumber } from "../../util/escape";
import { toSurrealqlString } from "../../util/to-surrealql-string";
import { Value } from "../value";
import { Uuid } from "./uuid";

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

	constructor(tb: Tb, id: RecordIdValue) {
		super();

		if (typeof tb !== "string")
			throw new SurrealDbError("TB part is not valid");
		if (!isValidIdPart(id)) throw new SurrealDbError("ID part is not valid");

		this.tb = tb;
		this.id = id;
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

/**
 * A SurrealQL string-represented record ID value.
 */
export class StringRecordId extends Value {
	public readonly rid: string;

	constructor(rid: string | StringRecordId | RecordId) {
		super();

		// In some cases the same method may be used with different data sources
		// this can cause this method to be called with an already instanced class object.
		if (rid instanceof StringRecordId) {
			this.rid = rid.rid;
		} else if (rid instanceof RecordId) {
			this.rid = rid.toString();
		} else if (typeof rid === "string") {
			this.rid = rid;
		} else {
			throw new SurrealDbError("String Record ID must be a string");
		}
	}

	equals(other: unknown): boolean {
		if (!(other instanceof StringRecordId)) return false;
		return this.rid === other.rid;
	}

	toJSON(): string {
		return this.rid;
	}

	toString(): string {
		return this.rid;
	}
}

export function isValidIdPart(v: unknown): v is RecordIdValue {
	if (v instanceof Uuid) return true;

	switch (typeof v) {
		case "string":
		case "number":
		case "bigint":
			return true;
		case "object":
			return Array.isArray(v) || v !== null;
		default:
			return false;
	}
}

export function escapeIdPart(id: RecordIdValue): string {
	return id instanceof Uuid
		? `u"${id}"`
		: typeof id === "string"
			? escapeIdent(id)
			: typeof id === "bigint" || typeof id === "number"
				? escapeNumber(id)
				: toSurrealqlString(id);
}
