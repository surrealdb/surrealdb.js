import { TextParseError } from "../../errors.ts";
import { fromBase64Url } from "../../internal/base64.ts";
import { type Bound, BoundExcluded, BoundIncluded } from "../../utils/range.ts";
import {
    DateTime,
    Decimal,
    Duration,
    FileRef,
    GeometryPoint,
    Range,
    RecordId,
    RecordIdRange,
    type RecordIdValue,
    Table,
    Uuid,
} from "../../value/index.ts";

/**
 * Options used to configure the SQON text parser.
 */
export interface TextParseOptions {
    /**
     * Use native `Date` objects instead of custom `DateTime` objects.
     * Using `Date` objects will result in a loss of nanosecond precision.
     */
    useNativeDates?: boolean;
}

// The first character of every duration unit (`ns`, `us`, `µs`, `ms`, `s`, `m`, `h`, `d`, `w`, `y`).
const DURATION_UNIT_STARTS = new Set(["n", "u", "m", "s", "h", "d", "w", "y", "µ", "μ"]);

// Characters which terminate a value in a compound context (array, object, set, range).
const VALUE_TERMINATORS = new Set(["]", "}", ")", ","]);

const ANGLE_OPEN = "⟨"; // ⟨
const ANGLE_CLOSE = "⟩"; // ⟩

/**
 * A recursive-descent parser for the textual SQON (SurrealQL value) format.
 *
 * It parses a single SurrealQL value from a string and produces native
 * JavaScript values where possible, falling back to the SQON `Value`
 * derivatives for SurrealDB-specific types. The output shape matches what the
 * CBOR and JSON codecs produce when decoding.
 */
export class TextParser {
    readonly #src: string;
    readonly #opts: TextParseOptions;
    #pos = 0;

    constructor(src: string, opts: TextParseOptions = {}) {
        this.#src = src;
        this.#opts = opts;
    }

    /**
     * Parse a single SQON value and ensure the entire input was consumed.
     */
    parse(): unknown {
        this.#skipWs();
        const value = this.#parseValue();
        this.#skipWs();
        if (!this.#eof()) {
            this.#error(`Unexpected trailing input '${this.#peek()}'`);
        }
        return value;
    }

    // ------------------------------------------------------------------
    // Typed static entry points
    // ------------------------------------------------------------------

    static #expect<T>(
        input: string,
        options: TextParseOptions | undefined,
        expected: string,
        check: (value: unknown) => value is T,
    ): T {
        const value = new TextParser(input, options).parse();
        if (!check(value)) {
            throw new TextParseError(`Expected a ${expected} value`, 0);
        }
        return value;
    }

    /** Parse any single SQON value. */
    static parseValue(input: string, options?: TextParseOptions): unknown {
        return new TextParser(input, options).parse();
    }

    /** Parse a string value. */
    static parseString(input: string, options?: TextParseOptions): string {
        return TextParser.#expect(
            input,
            options,
            "string",
            (v): v is string => typeof v === "string",
        );
    }

    /** Parse a numeric value (`int` as `number`/`bigint`, `float` as `number`). */
    static parseNumber(input: string, options?: TextParseOptions): number | bigint {
        return TextParser.#expect(
            input,
            options,
            "number",
            (v): v is number | bigint => typeof v === "number" || typeof v === "bigint",
        );
    }

    /** Parse a boolean value. */
    static parseBool(input: string, options?: TextParseOptions): boolean {
        return TextParser.#expect(
            input,
            options,
            "boolean",
            (v): v is boolean => typeof v === "boolean",
        );
    }

    /** Parse a decimal value. */
    static parseDecimal(input: string, options?: TextParseOptions): Decimal {
        return TextParser.#expect(
            input,
            options,
            "decimal",
            (v): v is Decimal => v instanceof Decimal,
        );
    }

    /** Parse a duration value. */
    static parseDuration(input: string, options?: TextParseOptions): Duration {
        return TextParser.#expect(
            input,
            options,
            "duration",
            (v): v is Duration => v instanceof Duration,
        );
    }

    /** Parse a datetime value (a `Date` when `useNativeDates` is set). */
    static parseDatetime(input: string, options?: TextParseOptions): DateTime | Date {
        return TextParser.#expect(
            input,
            options,
            "datetime",
            (v): v is DateTime | Date => v instanceof DateTime || v instanceof Date,
        );
    }

    /** Parse a UUID value. */
    static parseUuid(input: string, options?: TextParseOptions): Uuid {
        return TextParser.#expect(input, options, "uuid", (v): v is Uuid => v instanceof Uuid);
    }

    /** Parse a bytes value. */
    static parseBytes(input: string, options?: TextParseOptions): Uint8Array {
        return TextParser.#expect(
            input,
            options,
            "bytes",
            (v): v is Uint8Array => v instanceof Uint8Array,
        );
    }

    /** Parse a file reference value. */
    static parseFile(input: string, options?: TextParseOptions): FileRef {
        return TextParser.#expect(
            input,
            options,
            "file",
            (v): v is FileRef => v instanceof FileRef,
        );
    }

    /** Parse a table value. */
    static parseTable(input: string, options?: TextParseOptions): Table {
        return TextParser.#expect(input, options, "table", (v): v is Table => v instanceof Table);
    }

    /** Parse a record id value. */
    static parseRecordId(input: string, options?: TextParseOptions): RecordId {
        return TextParser.#expect(
            input,
            options,
            "record id",
            (v): v is RecordId => v instanceof RecordId,
        );
    }

    /** Parse a record id range value. */
    static parseRecordIdRange(input: string, options?: TextParseOptions): RecordIdRange {
        return TextParser.#expect(
            input,
            options,
            "record id range",
            (v): v is RecordIdRange => v instanceof RecordIdRange,
        );
    }

    /** Parse a range value. */
    static parseRange(input: string, options?: TextParseOptions): Range<unknown, unknown> {
        return TextParser.#expect(
            input,
            options,
            "range",
            (v): v is Range<unknown, unknown> => v instanceof Range,
        );
    }

    /** Parse a geometry point value. */
    static parseGeometryPoint(input: string, options?: TextParseOptions): GeometryPoint {
        return TextParser.#expect(
            input,
            options,
            "geometry point",
            (v): v is GeometryPoint => v instanceof GeometryPoint,
        );
    }

    /** Parse an array value. */
    static parseArray(input: string, options?: TextParseOptions): unknown[] {
        return TextParser.#expect(input, options, "array", (v): v is unknown[] => Array.isArray(v));
    }

    /** Parse a set value. */
    static parseSet(input: string, options?: TextParseOptions): Set<unknown> {
        return TextParser.#expect(
            input,
            options,
            "set",
            (v): v is Set<unknown> => v instanceof Set,
        );
    }

    /** Parse a plain object value. */
    static parseObject(input: string, options?: TextParseOptions): Record<string, unknown> {
        return TextParser.#expect(
            input,
            options,
            "object",
            (v): v is Record<string, unknown> =>
                typeof v === "object" &&
                v !== null &&
                !Array.isArray(v) &&
                Object.getPrototypeOf(v) === Object.prototype,
        );
    }

    // ------------------------------------------------------------------
    // Reader helpers
    // ------------------------------------------------------------------

    #eof(): boolean {
        return this.#pos >= this.#src.length;
    }

    #peek(offset = 0): string | undefined {
        return this.#src[this.#pos + offset];
    }

    #next(): string {
        const char = this.#src[this.#pos];
        if (char === undefined) this.#error("Unexpected end of input");
        this.#pos += 1;
        return char;
    }

    #skipWs(): void {
        while (this.#pos < this.#src.length) {
            const code = this.#src.charCodeAt(this.#pos);
            // space, tab, newline, carriage return, form feed, vertical tab
            if (
                code === 32 ||
                code === 9 ||
                code === 10 ||
                code === 13 ||
                code === 12 ||
                code === 11
            ) {
                this.#pos += 1;
            } else {
                break;
            }
        }
    }

    #error(message: string): never {
        throw new TextParseError(message, this.#pos);
    }

    // ------------------------------------------------------------------
    // Value & range dispatch
    // ------------------------------------------------------------------

    #parseValue(): unknown {
        this.#skipWs();

        // A leading range operator means an unbounded start bound.
        if (this.#peek() === "." && this.#peek(1) === ".") {
            this.#pos += 2;
            const end = this.#parseRangeEnd(this.#parsePrimeBound.bind(this));
            return new Range(undefined, end);
        }

        const left = this.#parsePrime();

        // Record ids consume their own range operator, so they are never the
        // begin bound of a plain range.
        if (left instanceof RecordId || left instanceof RecordIdRange) {
            return left;
        }

        const mark = this.#pos;
        this.#skipWs();

        let exclusive = false;
        if (this.#peek() === ">" && this.#peek(1) === "." && this.#peek(2) === ".") {
            this.#pos += 1;
            exclusive = true;
        }

        if (this.#peek() === "." && this.#peek(1) === ".") {
            this.#pos += 2;
            const begin = exclusive ? new BoundExcluded(left) : new BoundIncluded(left);
            const end = this.#parseRangeEnd(this.#parsePrimeBound.bind(this));
            return new Range(begin, end);
        }

        // No range operator: rewind any whitespace we skipped.
        this.#pos = mark;
        return left;
    }

    // The value used as a range bound; never itself a range.
    #parsePrimeBound(): unknown {
        return this.#parsePrime();
    }

    // Parse the end bound of a range, given a function that parses a bound value.
    #parseRangeEnd<T>(parseInner: () => T): Bound<T> {
        let inclusive = false;
        if (this.#peek() === "=") {
            this.#pos += 1;
            inclusive = true;
        }

        this.#skipWs();
        if (this.#canStartValue()) {
            const value = parseInner();
            return inclusive ? new BoundIncluded(value) : new BoundExcluded(value);
        }

        if (inclusive) {
            this.#error("Expected a value after inclusive range operator '..='");
        }
        return undefined;
    }

    #canStartValue(): boolean {
        const char = this.#peek();
        if (char === undefined) return false;
        if (VALUE_TERMINATORS.has(char)) return false;
        // A range operator does not start a value.
        if (char === "." && this.#peek(1) === ".") return false;
        return true;
    }

    // ------------------------------------------------------------------
    // Prime values
    // ------------------------------------------------------------------

    #parsePrime(): unknown {
        this.#skipWs();
        const char = this.#peek();

        if (char === undefined) this.#error("Unexpected end of input, expected a value");

        switch (char) {
            case '"':
            case "'":
                return this.#readQuoted(char);
            case "[":
                return this.#parseArray();
            case "{":
                return this.#parseObjectOrSet();
            case "(":
                return this.#parseGeometryOrGroup();
            case "`":
            case ANGLE_OPEN:
                return this.#parseIdentValue();
        }

        const code = char.charCodeAt(0);
        // digits, `+`, `-`
        if ((code >= 48 && code <= 57) || char === "+" || char === "-") {
            return this.#parseNumberLike();
        }

        // Identifier-like: keywords, prefixed literals, tables, record ids.
        if (this.#isIdentStart(code)) {
            // Prefixed string-like literals: s/d/u/b/f/r immediately followed by a quote.
            const next = this.#peek(1);
            if ((next === '"' || next === "'") && "sdubfr".includes(char)) {
                return this.#parsePrefixedLiteral(char, next);
            }
            return this.#parseIdentValue();
        }

        this.#error(`Unexpected character '${char}', expected a value`);
    }

    #isIdentStart(code: number): boolean {
        return (
            (code >= 65 && code <= 90) || // A-Z
            (code >= 97 && code <= 122) || // a-z
            code === 95 // _
        );
    }

    #isIdentContinue(code: number): boolean {
        return (
            (code >= 48 && code <= 57) || // 0-9
            (code >= 65 && code <= 90) || // A-Z
            (code >= 97 && code <= 122) || // a-z
            code === 95 // _
        );
    }

    // ------------------------------------------------------------------
    // Identifiers, tables & record ids
    // ------------------------------------------------------------------

    #parseIdentValue(): unknown {
        const { name, quoted } = this.#parseIdentRaw();

        if (!quoted) {
            switch (name.toLowerCase()) {
                case "none":
                    return undefined;
                case "null":
                    return null;
                case "true":
                    return true;
                case "false":
                    return false;
            }
            if (name === "Infinity") return Number.POSITIVE_INFINITY;
            if (name === "NaN") return Number.NaN;
        }

        if (this.#peek() === ":") {
            return this.#parseRecordIdOrRange(name);
        }

        return new Table(name);
    }

    #parseIdentRaw(): { name: string; quoted: boolean } {
        const char = this.#peek();

        if (char === "`") {
            this.#pos += 1;
            return { name: this.#readDelimitedIdent("`"), quoted: true };
        }

        if (char === ANGLE_OPEN) {
            this.#pos += 1;
            return { name: this.#readDelimitedIdent(ANGLE_CLOSE), quoted: true };
        }

        const start = this.#pos;
        const startCode = char === undefined ? -1 : char.charCodeAt(0);
        if (!this.#isIdentStart(startCode)) {
            this.#error("Expected an identifier");
        }
        this.#pos += 1;
        while (!this.#eof() && this.#isIdentContinue(this.#src.charCodeAt(this.#pos))) {
            this.#pos += 1;
        }
        return { name: this.#src.slice(start, this.#pos), quoted: false };
    }

    #readDelimitedIdent(close: string): string {
        let result = "";
        while (true) {
            const char = this.#peek();
            if (char === undefined) {
                this.#error(`Unterminated identifier, expected '${close}'`);
            }
            if (char === "\\" && this.#peek(1) === close) {
                result += close;
                this.#pos += 2;
                continue;
            }
            this.#pos += 1;
            if (char === close) break;
            result += char;
        }
        return result;
    }

    #parseRecordIdOrRange(table: string): RecordId | RecordIdRange {
        this.#pos += 1; // consume ':'

        // Range with an unbounded start bound: `table:..end`.
        if (this.#peek() === "." && this.#peek(1) === ".") {
            this.#pos += 2;
            const end = this.#parseRangeEnd(this.#parseRecordIdKey.bind(this));
            return new RecordIdRange(table, undefined, end as Bound<RecordIdValue>);
        }

        const begin = this.#parseRecordIdKey();

        let exclusive = false;
        if (this.#peek() === ">" && this.#peek(1) === "." && this.#peek(2) === ".") {
            this.#pos += 1;
            exclusive = true;
        }

        if (this.#peek() === "." && this.#peek(1) === ".") {
            this.#pos += 2;
            const beginBound = exclusive ? new BoundExcluded(begin) : new BoundIncluded(begin);
            const end = this.#parseRangeEnd(this.#parseRecordIdKey.bind(this));
            return new RecordIdRange(table, beginBound, end as Bound<RecordIdValue>);
        }

        if (exclusive) {
            this.#error("Expected the range operator '..' after '>'");
        }

        return new RecordId(table, begin);
    }

    #parseRecordIdKey(): RecordIdValue {
        this.#skipWs();
        const char = this.#peek();

        if (char === undefined) this.#error("Expected a record id key");

        if (char === '"' || char === "'") {
            return this.#readQuoted(char);
        }
        if (char === "u" && (this.#peek(1) === '"' || this.#peek(1) === "'")) {
            return this.#parsePrefixedLiteral("u", this.#peek(1) as string) as Uuid;
        }
        if (char === "{") {
            return this.#parseObjectOrSet() as RecordIdValue;
        }
        if (char === "[") {
            return this.#parseArray();
        }

        const code = char.charCodeAt(0);
        if (char === "+" || char === "-" || (code >= 48 && code <= 57)) {
            return this.#parseIntegerKey();
        }

        // Bare, backtick, or angle-bracket identifier as a string key.
        return this.#parseIdentRaw().name;
    }

    #parseIntegerKey(): number | bigint {
        const start = this.#pos;
        if (this.#peek() === "+" || this.#peek() === "-") this.#pos += 1;
        const digitsStart = this.#pos;
        while (!this.#eof() && this.#isDigit(this.#src.charCodeAt(this.#pos))) this.#pos += 1;
        if (this.#pos === digitsStart) this.#error("Expected an integer record id key");
        return this.#finishInteger(this.#src.slice(start, this.#pos));
    }

    // ------------------------------------------------------------------
    // Numbers, durations, decimals
    // ------------------------------------------------------------------

    #isDigit(code: number): boolean {
        return code >= 48 && code <= 57;
    }

    #parseNumberLike(): unknown {
        const start = this.#pos;
        if (this.#peek() === "+" || this.#peek() === "-") this.#pos += 1;

        this.#eatDigits();
        if (
            this.#pos === start ||
            (this.#pos === start + 1 && !this.#isDigit(this.#src.charCodeAt(start)))
        ) {
            // Only a sign was consumed with no digits.
            this.#pos = start;
            this.#error("Expected a number");
        }

        // Duration: an integer immediately followed by a unit letter (but not the
        // `dec`/`f` numeric suffixes).
        const letters = this.#peekLetterRun();
        if (letters !== "dec" && letters !== "f" && DURATION_UNIT_STARTS.has(this.#peek() ?? "")) {
            return this.#finishDuration(start);
        }

        let isFloat = false;

        // Fractional part (only when followed by a digit, so `1..2` stays a range).
        if (this.#peek() === "." && this.#isDigit(this.#src.charCodeAt(this.#pos + 1))) {
            this.#pos += 1;
            this.#eatDigits();
            isFloat = true;
        }

        // Exponent.
        if (this.#peek() === "e" || this.#peek() === "E") {
            const afterE = this.#peek(1);
            const afterSign = afterE === "+" || afterE === "-" ? this.#peek(2) : afterE;
            if (afterSign !== undefined && this.#isDigit(afterSign.charCodeAt(0))) {
                this.#pos += 1;
                if (this.#peek() === "+" || this.#peek() === "-") this.#pos += 1;
                this.#eatDigits();
                isFloat = true;
            }
        }

        const numeric = this.#src.slice(start, this.#pos).replace(/_/g, "");

        // Numeric type suffixes.
        const suffix = this.#peekLetterRun();
        if (suffix === "dec") {
            this.#pos += 3;
            return new Decimal(numeric);
        }
        if (suffix === "f") {
            this.#pos += 1;
            return Number.parseFloat(numeric);
        }

        if (isFloat) {
            return Number.parseFloat(numeric);
        }

        return this.#finishInteger(numeric);
    }

    #finishInteger(numeric: string): number | bigint {
        let value: bigint;
        try {
            value = BigInt(numeric);
        } catch {
            this.#error(`Invalid integer '${numeric}'`);
        }
        if (value >= BigInt(Number.MIN_SAFE_INTEGER) && value <= BigInt(Number.MAX_SAFE_INTEGER)) {
            return Number(value);
        }
        return value;
    }

    #finishDuration(start: number): Duration {
        while (!this.#eof()) {
            const char = this.#src[this.#pos];
            const code = char.charCodeAt(0);
            if (this.#isDigit(code) || DURATION_UNIT_STARTS.has(char)) {
                this.#pos += 1;
            } else {
                break;
            }
        }
        return new Duration(this.#src.slice(start, this.#pos));
    }

    #eatDigits(): void {
        while (!this.#eof()) {
            const code = this.#src.charCodeAt(this.#pos);
            if (this.#isDigit(code) || code === 95 /* _ */) {
                this.#pos += 1;
            } else {
                break;
            }
        }
    }

    // Peek at the maximal run of ASCII-letter (plus µ/μ) characters without consuming.
    #peekLetterRun(): string {
        let index = this.#pos;
        while (index < this.#src.length) {
            const char = this.#src[index];
            const code = char.charCodeAt(0);
            if (
                (code >= 65 && code <= 90) ||
                (code >= 97 && code <= 122) ||
                char === "µ" ||
                char === "μ"
            ) {
                index += 1;
            } else {
                break;
            }
        }
        return this.#src.slice(this.#pos, index);
    }

    // ------------------------------------------------------------------
    // Strings & prefixed literals
    // ------------------------------------------------------------------

    #readQuoted(quote: string): string {
        this.#pos += 1; // opening quote
        let result = "";
        while (true) {
            const char = this.#peek();
            if (char === undefined) this.#error("Unterminated string literal");
            this.#pos += 1;
            if (char === quote) break;
            if (char === "\\") {
                result += this.#readEscape();
            } else {
                result += char;
            }
        }
        return result;
    }

    #readEscape(): string {
        const char = this.#next();
        switch (char) {
            case "n":
                return "\n";
            case "t":
                return "\t";
            case "r":
                return "\r";
            case "b":
                return "\b";
            case "f":
                return "\f";
            case "0":
                return "\0";
            case "\\":
                return "\\";
            case "/":
                return "/";
            case '"':
                return '"';
            case "'":
                return "'";
            case "`":
                return "`";
            case "u":
                return this.#readUnicodeEscape();
            default:
                // Unknown escape: keep the character verbatim.
                return char;
        }
    }

    #readUnicodeEscape(): string {
        if (this.#peek() === "{") {
            this.#pos += 1;
            const start = this.#pos;
            while (!this.#eof() && this.#peek() !== "}") this.#pos += 1;
            const hex = this.#src.slice(start, this.#pos);
            if (this.#peek() !== "}") this.#error("Unterminated unicode escape");
            this.#pos += 1;
            const code = Number.parseInt(hex, 16);
            if (Number.isNaN(code)) this.#error(`Invalid unicode escape '\\u{${hex}}'`);
            return String.fromCodePoint(code);
        }

        const hex = this.#src.slice(this.#pos, this.#pos + 4);
        if (hex.length !== 4 || Number.isNaN(Number.parseInt(hex, 16))) {
            this.#error(`Invalid unicode escape '\\u${hex}'`);
        }
        this.#pos += 4;
        return String.fromCharCode(Number.parseInt(hex, 16));
    }

    #parsePrefixedLiteral(prefix: string, quote: string): unknown {
        this.#pos += 1; // consume the prefix letter
        const inner = this.#readQuoted(quote);

        switch (prefix) {
            case "s":
                return inner;
            case "d":
                return this.#opts.useNativeDates ? new Date(inner) : new DateTime(inner);
            case "u":
                return new Uuid(inner);
            case "b":
                return this.#decodeBytes(inner);
            case "f":
                return this.#parseFileRef(inner);
            case "r":
                return this.#parseInnerRecordId(inner);
            default:
                this.#error(`Unknown literal prefix '${prefix}'`);
        }
    }

    #decodeBytes(inner: string): Uint8Array {
        const clean = inner.replace(/\s+/g, "");
        if (clean.length % 2 !== 0 || /[^0-9a-fA-F]/.test(clean)) {
            // Fall back to base64url for compatibility with the JSON codec form.
            try {
                return fromBase64Url(inner);
            } catch {
                this.#error("Invalid bytes literal, expected a hex string");
            }
        }
        const bytes = new Uint8Array(clean.length / 2);
        for (let i = 0; i < bytes.length; i++) {
            bytes[i] = Number.parseInt(clean.slice(i * 2, i * 2 + 2), 16);
        }
        return bytes;
    }

    #parseFileRef(inner: string): FileRef {
        const separator = inner.indexOf(":");
        if (separator === -1) {
            this.#error("Invalid file reference, expected 'bucket:/key'");
        }
        return new FileRef(inner.slice(0, separator), inner.slice(separator + 1));
    }

    #parseInnerRecordId(inner: string): RecordId | RecordIdRange {
        const parser = new TextParser(inner, this.#opts);
        parser.#skipWs();
        const { name } = parser.#parseIdentRaw();
        if (parser.#peek() !== ":") {
            parser.#error("Expected a record id");
        }
        const record = parser.#parseRecordIdOrRange(name);
        parser.#skipWs();
        if (!parser.#eof()) {
            parser.#error("Unexpected trailing input in record id literal");
        }
        return record;
    }

    // ------------------------------------------------------------------
    // Arrays, objects & sets
    // ------------------------------------------------------------------

    #parseArray(): unknown[] {
        this.#pos += 1; // consume '['
        const result: unknown[] = [];
        this.#skipWs();
        if (this.#peek() === "]") {
            this.#pos += 1;
            return result;
        }

        while (true) {
            result.push(this.#parseValue());
            this.#skipWs();
            const char = this.#peek();
            if (char === ",") {
                this.#pos += 1;
                this.#skipWs();
                if (this.#peek() === "]") {
                    this.#pos += 1;
                    break;
                }
                continue;
            }
            if (char === "]") {
                this.#pos += 1;
                break;
            }
            this.#error("Expected ',' or ']' in array");
        }
        return result;
    }

    #parseObjectOrSet(): Record<string, unknown> | Set<unknown> {
        this.#pos += 1; // consume '{'
        this.#skipWs();

        if (this.#peek() === "}") {
            this.#pos += 1;
            return {};
        }

        // Speculatively try to parse an object entry (`key:`).
        const mark = this.#pos;
        const key = this.#tryParseObjectKey();
        if (key !== null) {
            this.#skipWs();
            if (this.#peek() === ":") {
                this.#pos += 1;
                return this.#parseObjectRest(key);
            }
        }

        // Not an object, so it must be a set.
        this.#pos = mark;
        return this.#parseSet();
    }

    #tryParseObjectKey(): string | null {
        const char = this.#peek();
        if (char === undefined) return null;
        if (char === '"' || char === "'") return this.#readQuoted(char);

        const code = char.charCodeAt(0);
        if (this.#isIdentStart(code)) {
            return this.#parseIdentRaw().name;
        }
        if (char === "`" || char === ANGLE_OPEN) {
            return this.#parseIdentRaw().name;
        }
        // Numeric keys are permitted.
        if (this.#isDigit(code)) {
            const start = this.#pos;
            while (!this.#eof() && this.#isDigit(this.#src.charCodeAt(this.#pos))) this.#pos += 1;
            return this.#src.slice(start, this.#pos);
        }
        return null;
    }

    #parseObjectRest(firstKey: string): Record<string, unknown> {
        const result: Record<string, unknown> = {};
        result[firstKey] = this.#parseValue();

        while (true) {
            this.#skipWs();
            const char = this.#peek();
            if (char === "}") {
                this.#pos += 1;
                break;
            }
            if (char !== ",") {
                this.#error("Expected ',' or '}' in object");
            }
            this.#pos += 1;
            this.#skipWs();
            if (this.#peek() === "}") {
                this.#pos += 1;
                break;
            }
            const key = this.#tryParseObjectKey();
            if (key === null) this.#error("Expected an object key");
            this.#skipWs();
            if (this.#peek() !== ":") this.#error("Expected ':' after object key");
            this.#pos += 1;
            result[key] = this.#parseValue();
        }
        return result;
    }

    #parseSet(): Set<unknown> {
        const result = new Set<unknown>();
        while (true) {
            result.add(this.#parseValue());
            this.#skipWs();
            const char = this.#peek();
            if (char === ",") {
                this.#pos += 1;
                this.#skipWs();
                if (this.#peek() === "}") {
                    this.#pos += 1;
                    break;
                }
                continue;
            }
            if (char === "}") {
                this.#pos += 1;
                break;
            }
            this.#error("Expected ',' or '}' in set");
        }
        return result;
    }

    // ------------------------------------------------------------------
    // Geometry & grouping
    // ------------------------------------------------------------------

    #parseGeometryOrGroup(): unknown {
        this.#pos += 1; // consume '('
        this.#skipWs();

        // Speculatively try to parse a geometry point: `(x, y)`.
        const mark = this.#pos;
        const point = this.#tryParsePoint();
        if (point !== null) return point;

        this.#pos = mark;
        const value = this.#parseValue();
        this.#skipWs();
        if (this.#peek() !== ")") this.#error("Expected ')'");
        this.#pos += 1;
        return value;
    }

    #tryParsePoint(): GeometryPoint | null {
        const char = this.#peek();
        if (char === undefined) return null;
        const code = char.charCodeAt(0);
        if (!(this.#isDigit(code) || char === "+" || char === "-")) return null;

        try {
            const x = this.#parseNumberLike();
            if (!this.#isNumeric(x)) return null;
            this.#skipWs();
            if (this.#peek() !== ",") return null;
            this.#pos += 1;
            this.#skipWs();
            const y = this.#parseNumberLike();
            if (!this.#isNumeric(y)) return null;
            this.#skipWs();
            if (this.#peek() !== ")") return null;
            this.#pos += 1;
            return new GeometryPoint([this.#toCoordinate(x), this.#toCoordinate(y)]);
        } catch {
            return null;
        }
    }

    #isNumeric(value: unknown): boolean {
        return typeof value === "number" || typeof value === "bigint" || value instanceof Decimal;
    }

    #toCoordinate(value: unknown): number | Decimal {
        if (typeof value === "bigint") return Number(value);
        return value as number | Decimal;
    }
}

/**
 * Parse a single SurrealQL value from a SQON text string.
 *
 * @param input The SQON text to parse
 * @param options Parser options
 * @returns The parsed value, as a native JavaScript value or SQON `Value` derivative
 */
export function parseText(input: string, options?: TextParseOptions): unknown {
    return new TextParser(input, options).parse();
}
