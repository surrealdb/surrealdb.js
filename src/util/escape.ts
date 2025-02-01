const MAX_i64 = 9223372036854775807n;

/**
 * Escape a given string to be used as a valid SurrealQL ident.
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
 * Escape a given string to be used as a valid SurrealQL ident.
 * @param str - The string to escape
 * @returns Optionally escaped string
 * @deprecated Use `escapeIdent` instead
 */
export function escape_ident(str: string): string {
	return escapeIdent(str);
}

/**
 * Escape a number to be used as a valid SurrealQL ident.
 * @param num - The number to escape
 * @returns Optionally escaped number
 */
export function escapeNumber(num: number | bigint): string {
	return num <= MAX_i64 ? num.toString() : `⟨${num}⟩`;
}

function isOnlyNumbers(str: string): boolean {
	return /^\d+$/.test(str.replace(/_/g, ""));
}
