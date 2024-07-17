import { SurrealDbError } from "../../errors";

const MAX_i64 = 9223372036854775807n;
export type RecordIdValue =
	| string
	| number
	| bigint
	| unknown[]
	| Record<string, unknown>;

export class RecordId<Tb extends string = string> {
	public readonly tb: Tb;
	public readonly id: RecordIdValue;

	constructor(tb: Tb, id: RecordIdValue) {
		if (typeof tb !== "string")
			throw new SurrealDbError("TB part is not valid");
		if (!isValidIsPart(id)) throw new SurrealDbError("ID part is not valid");

		this.tb = tb;
		this.id = id;
	}

	toJSON(): string {
		return this.toString();
	}

	toString(): string {
		const tb = escape_ident(this.tb);
		const id =
			typeof this.id === "string"
				? escape_ident(this.id)
				: typeof this.id === "bigint" || typeof this.id === "number"
					? escape_number(this.id)
					: JSON.stringify(this.id);
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

function escape_number(num: number | bigint) {
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
			return `⟨${str.replaceAll("⟩", "⟩")}⟩`;
		}
	}

	return str;
}

function isOnlyNumbers(str: string) {
	const parsed = Number.parseInt(str);
	return !Number.isNaN(parsed) && parsed.toString() === str;
}

function isValidIsPart(v: unknown): v is RecordIdValue {
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
