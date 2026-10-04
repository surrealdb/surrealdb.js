const WHITESPACE = /\s/;
const WORD_START = /[A-Za-z_]/;
const WORD_PART = /[A-Za-z0-9_]/;

// Line feed, carriage return, line separator and paragraph separator
const LINE_BREAKS = new Set([0x0a, 0x0d, 0x2028, 0x2029]);

/**
 * Skip a quoted run (a string, a backtick or an angle bracket identifier) which starts at
 * `start` and is closed by `close`, honoring backslash escapes.
 *
 * @returns The index just past the closing character, or the end of the source if unclosed
 */
function skipQuoted(source: string, start: number, close: string): number {
    let i = start + 1;

    while (i < source.length) {
        const char = source[i];

        if (char === "\\") {
            i += 2;
        } else if (char === close) {
            return i + 1;
        } else {
            i++;
        }
    }

    return source.length;
}

/**
 * Skip a line comment starting at `start`.
 *
 * @returns The index of the line break which ends the comment, or the end of the source
 */
function skipLine(source: string, start: number): number {
    let i = start;

    while (i < source.length && !LINE_BREAKS.has(source.charCodeAt(i))) {
        i++;
    }

    return i;
}

/**
 * Split a SurrealQL source into its top level statements and report the keyword each one
 * starts with, upper-cased. A statement which does not start with a word, such as a bare
 * `(1 + 2)` or `{ a: 1 }`, is reported as an empty string. Empty statements are not reported.
 *
 * This is deliberately **not** a parser. It only knows enough about the lexical structure of
 * SurrealQL to find where statements begin: strings, quoted identifiers and comments are
 * skipped, and a `;` only ends a statement outside of any `{}`, `()` or `[]`. That is enough
 * to answer "does a statement of this kind appear in this query?" without being fooled by a
 * `BEGIN` inside a string, a comment or a block.
 *
 * @param source The SurrealQL to scan
 * @returns The first keyword of each top level statement, in order
 */
export function scanStatements(source: string): string[] {
    const statements: string[] = [];
    let current: string | undefined;
    let depth = 0;
    let i = 0;

    const begin = (keyword: string) => {
        current ??= keyword;
    };

    while (i < source.length) {
        const char = source[i];

        if (WHITESPACE.test(char)) {
            i++;
        } else if (
            char === "#" ||
            (char === "-" && source[i + 1] === "-") ||
            (char === "/" && source[i + 1] === "/")
        ) {
            i = skipLine(source, i);
        } else if (char === "/" && source[i + 1] === "*") {
            const end = source.indexOf("*/", i + 2);
            i = end === -1 ? source.length : end + 2;
        } else if (char === "'" || char === '"' || char === "`") {
            begin("");
            i = skipQuoted(source, i, char);
        } else if (char === "⟨") {
            begin("");
            i = skipQuoted(source, i, "⟩");
        } else if (char === ";" && depth === 0) {
            if (current !== undefined) statements.push(current);
            current = undefined;
            i++;
        } else if (char === "{" || char === "(" || char === "[") {
            begin("");
            depth++;
            i++;
        } else if (char === "}" || char === ")" || char === "]") {
            depth = Math.max(0, depth - 1);
            i++;
        } else if (current === undefined && WORD_START.test(char)) {
            const start = i;

            while (i < source.length && WORD_PART.test(source[i])) {
                i++;
            }

            begin(source.slice(start, i).toUpperCase());
        } else {
            begin("");
            i++;
        }
    }

    if (current !== undefined) statements.push(current);

    return statements;
}
