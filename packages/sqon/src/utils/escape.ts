import { isValidIdPart } from "../internal/validation.ts";
import { Range, type RecordIdValue, Uuid } from "../value/index.ts";
import type { Bound } from "./range.ts";
import { toSurrealqlString } from "./to-surql-string.ts";

const MAX_i64 = 9223372036854775807n;

/**
 * Set of reserved keywords in SurrealQL that cannot be used as bare identifiers.
 * Sourced from `surrealdb/core/src/syn/lexer/keywords.rs` (RESERVED_KEYWORD + EXPLAIN).
 */
const SURREAL_RESERVED_KEYWORDS = new Set([
    "alter",
    "begin",
    "break",
    "cancel",
    "commit",
    "continue",
    "create",
    "define",
    "delete",
    "for",
    "if",
    "info",
    "insert",
    "kill",
    "live",
    "option",
    "rebuild",
    "return",
    "relate",
    "remove",
    "select",
    "let",
    "show",
    "sleep",
    "throw",
    "update",
    "upsert",
    "use",
    "diff",
    "rand",
    "none",
    "null",
    "after",
    "before",
    "value",
    "by",
    "all",
    "true",
    "false",
    "where",
    "table",
    "tb",
    "sequence",
    "function",
    "explain",
]);

/**
 * Escape a given string to be used as a valid SurrealQL ident
 *
 * @param str - The string to escape
 * @returns Optionally escaped string
 */
export function escapeIdent(str: string): string {
    if (str === "") {
        return "⟨⟩";
    }
    // removed isOnlyNumbers() since this covers it
    const first = str.charCodeAt(0);
    if (first > 47 && first < 58) {
        return delimitIdent(str);
    }

    if (str === "NaN" || str === "Infinity") {
        return `⟨${str}⟩`;
    }

    if (SURREAL_RESERVED_KEYWORDS.has(str.toLowerCase())) {
        return delimitIdent(str);
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
            return delimitIdent(str);
        }
    }

    return str;
}

/**
 * Surround an ident with delimiters, escaping the backslashes and delimiters inside it.
 *
 * Every supported SurrealDB version reads `\\` and `` \` `` inside a backtick ident, but
 * escapes inside `⟨⟩` differ: 2.1.0 to 2.1.3 read none, later 2.x versions read `\⟩`, and
 * 3.x rejects `\⟩`. An ident containing `\` or `⟩` is therefore surrounded with backticks.
 *
 * @param str - The ident to surround
 * @returns Surrounded ident
 */
function delimitIdent(str: string): string {
    if (!str.includes("\\") && !str.includes("⟩")) {
        return `⟨${str}⟩`;
    }

    return `\`${str.replaceAll("\\", "\\\\").replaceAll("`", "\\`")}\``;
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
        ? `u"${(id as unknown as Uuid).toString()}"`
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
    if (value instanceof Range)
        return `(${toSurrealqlString(value as unknown as Range<unknown, unknown>)})`;
    return toSurrealqlString(value);
}
