import { SurrealDbError } from "../../errors";
import { toSurrealqlString } from "../../util/to-surrealql-string";
import { Uuid } from "./uuid";

const MAX_i64 = 9223372036854775807n;
export type RecordIdValue =
	| string
	| number
	| Uuid
	| bigint
	| unknown[]
	| Record<string, unknown>;

export class RecordId<Tb extends string = string> {
	public readonly tb: Tb;
	public readonly id: RecordIdValue;

	constructor(tb: Tb, id: RecordIdValue) {
		if (typeof tb !== "string")
			throw new SurrealDbError("TB part is not valid");
		if (!isValidIdPart(id)) throw new SurrealDbError("ID part is not valid");

		this.tb = tb;
		this.id = id;
	}

	toJSON(): string {
		return this.toString();
	}

	toString(): string {
		const tb = escape_ident(this.tb);
		const id = escape_id_part(this.id);
		return `${tb}:${id}`;
	}
}

export class StringRecordId {
	public readonly rid: string;

	constructor(rid: string) {
		if (typeof rid !== "string")
			throw new SurrealDbError("String Record ID must be a string");

		this.rid = rid;
	}

	toJSON(): string {
		return this.rid;
	}

	toString(): string {
		return this.rid;
	}
}

export function escape_number(num: number | bigint): string {
	return num <= MAX_i64 ? num.toString() : `⟨${num}⟩`;
}

export function escape_ident(str: string): string {
	// String which looks like a number should always be escaped, to prevent it from being parsed as a number
	if (isOnlyNumbers(str)) {
		return `⟨${str}⟩`;
	}

	let code: number;
	let i: number;
	let len: number;

	for (i = 0, len = str.length; i < len; i++) {
		code = str.charCodeAt(i);
		if (
			!(code > 47 && code < 58) && // numeric (0-9)
			!(code > 64 && code < 91) && // upper alpha (A-Z)
			!(code > 96 && code < 123) && // lower alpha (a-z)
			!(code === 95) // underscore (_)
		) {
			return `⟨${str.replaceAll("⟩", "\\⟩")}⟩`;
		}
	}

	return str;
}

export function isOnlyNumbers(str: string): boolean {
	const stripped = str.replace("_", "");
	const parsed = Number.parseInt(stripped);
	return !Number.isNaN(parsed) && parsed.toString() === stripped;
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

export function escape_id_part(id: RecordIdValue): string {
	return id instanceof Uuid
		? `u"${id}"`
		: typeof id === "string"
			? escape_ident(id)
			: typeof id === "bigint" || typeof id === "number"
				? escape_number(id)
				: toSurrealqlString(id);
}
