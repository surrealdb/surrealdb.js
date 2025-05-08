import { isValidIdPart } from "../internal/validation";
import { Range, type RecordIdValue, Uuid } from "../value";
import type { Bound } from "./range";
import { toSurrealqlString } from "./to-surql-string";

const MAX_i64 = 9223372036854775807n;

function isOnlyNumbers(str: string): boolean {
	return /^[\d_]+$/.test(str);
}

/**
 * Escape a given string to be used as a valid SurrealQL ident
 *
 * @param str - The string to escape
 * @returns Optionally escaped string
 */
export function escapeIdent(str: string): string {
	// String which looks like a number should always be escaped, to prevent it from being parsed as a number
	if (isOnlyNumbers(str)) {
		return `⟨${str}⟩`;
	}

	// Empty string should always be escaped
	if (str === "") {
		return "⟨⟩";
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

/**
 * Escape a number to be used as a valid SurrealQL ident
 *
 * @param num - The number to escape
 * @returns Optionally escaped number
 */
export function escapeNumber(num: number | bigint): string {
	return num <= MAX_i64 ? num.toString() : `⟨${num}⟩`;
}

/**
 * Escape a record id value part
 *
 * @param id The record id value part
 * @returns The escaped record id value part
 */
export function escapeIdPart(id: RecordIdValue): string {
	return id instanceof Uuid
		? `u"${id}"`
		: typeof id === "string"
			? escapeIdent(id)
			: typeof id === "bigint" || typeof id === "number"
				? escapeNumber(id)
				: toSurrealqlString(id);
}

/**
 * Escape a range bound value
 *
 * @param bound The range bound containing a value
 * @returns The escaped range bound
 */
export function escapeRangeBound<T>(bound: Bound<T>): string {
	if (bound === undefined) return "";
	const value = bound.value;

	if (isValidIdPart(value)) return escapeIdPart(value);
	if (value instanceof Range) return `(${toSurrealqlString(value)})`;
	return toSurrealqlString(value);
}
