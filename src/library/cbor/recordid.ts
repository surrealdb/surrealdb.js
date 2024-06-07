import { z } from "npm:zod";

export const RecordIdValue = z.union([
	z.string(),
	z.number(),
	z.bigint(),
	z.record(z.unknown()),
	z.array(z.unknown()),
]);

export type RecordIdValue = z.infer<typeof RecordIdValue>;

export class RecordId<Tb extends string = string> {
	public readonly tb: Tb;
	public readonly id: RecordIdValue;

	constructor(tb: Tb, id: RecordIdValue) {
		this.tb = z.string().parse(tb) as Tb;
		this.id = RecordIdValue.parse(id);
	}

	toJSON() {
		return this.toString();
	}

	toString() {
		const tb = escape_ident(this.tb);
		const id = typeof this.id == "string"
			? ["rand()", "ulid()", "uuid()"].includes(this.id)
				? this.id
				: escape_ident(this.id)
			: JSON.stringify(this.id);
		return `${tb}:${id}`;
	}
}

export class StringRecordId {
	public readonly rid: string;

	constructor(rid: string) {
		this.rid = z.string().parse(rid);
	}

	toJSON() {
		return this.rid;
	}

	toString() {
		return this.rid;
	}
}

function escape_ident(str: string) {
	let code, i, len;

	for (i = 0, len = str.length; i < len; i++) {
		code = str.charCodeAt(i);
		if (
			!(code > 47 && code < 58) && // numeric (0-9)
			!(code > 64 && code < 91) && // upper alpha (A-Z)
			!(code > 96 && code < 123) && // lower alpha (a-z)
			!(code == 95) // underscore (_)
		) {
			return `⟨${str.replaceAll("⟩", "\⟩")}⟩`;
		}
	}

	return str;
}
