import { SurrealError } from "../errors";
import { DateTime, Decimal, Duration, RecordId, Uuid } from "../value";
import { DURATION_PART_REGEX, SECOND, UNITS } from "../value/duration";
import { FileRef } from "../value/file";
import { Lexer, type Span } from "./lexer";
import { Option } from "./option";
import { Reader } from "./reader";
import { TokenKind } from "./token";

export class Parser {
    readonly reader: Reader;
    readonly lexer: Lexer;

    constructor(input: string | Reader) {
        this.reader = input instanceof Reader ? input : new Reader(input);
        this.lexer = new Lexer(this.reader);
    }

    parseValue() {
        const span = this.lexer.next();

        switch (span.kind) {
            case TokenKind.BraceOpen:
                return this.parseObject();
            case TokenKind.SquareOpen:
                return this.parseArray();

            case TokenKind.QuoteDouble:
            case TokenKind.StringDouble:
                return this.parseString();
            case TokenKind.QuoteSingle:
            case TokenKind.StringSingle:
                return this.parseString(false);

            case TokenKind.BytesDouble:
                return this.parseBytes();
            case TokenKind.BytesSingle:
                return this.parseBytes(false);

            case TokenKind.DatetimeDouble:
                return this.parseDatetime();
            case TokenKind.DatetimeSingle:
                return this.parseDatetime(false);

            case TokenKind.UuidDouble:
                return this.parseUuid();
            case TokenKind.UuidSingle:
                return this.parseUuid(false);

            case TokenKind.RecordDouble:
                return this.parseRecordString();
            case TokenKind.RecordSingle:
                return this.parseRecordString(false);

            case TokenKind.FileDouble:
                return this.parseFile();
            case TokenKind.FileSingle:
                return this.parseFile(false);

            case TokenKind.Number:
                return this.parseNumberLike(span);

            case TokenKind.Ident: {
                const raw = span.raw();
                const first = raw.charCodeAt(0) | 32; // Convert to lowercase
                
                // Fast path for common keywords using first char + length
                if (first === 116 && raw.length === 4) { // 't' and length 4
                    if (raw === "true" || raw === "TRUE" || raw === "True") return true;
                } else if (first === 102 && raw.length === 5) { // 'f' and length 5
                    if (raw === "false" || raw === "FALSE" || raw === "False") return false;
                } else if (first === 110) { // 'n'
                    if (raw.length === 4 && (raw === "null" || raw === "NULL" || raw === "Null")) return null;
                    if (raw.length === 4 && (raw === "none" || raw === "NONE" || raw === "None")) return undefined;
                }
                
                return this.parseRecord(span);
            }
            default:
                throw new SurrealError(`Unexpected token: ${span.kind}`);
        }
    }

    /**
     * Parses an object. Assumes that the opening brace is already consumed.
     */
    parseObject(): Record<string, unknown> {
        const res: Record<string, unknown> = Object.create(null);

        while (true) {
            if (this.lexer.eat(TokenKind.BraceClose)) {
                return res;
            }

            const key = this.parseObjectKey();
            this.lexer.expect(TokenKind.Colon);
            const value = this.parseValue();
            res[key] = value;

            if (!this.lexer.eat(TokenKind.Comma)) {
                this.lexer.expect(TokenKind.BraceClose);
                return res;
            }
        }
    }

    /**
     * Parses an array. Assumes that the opening bracket is already consumed.
     */
    parseArray(): unknown[] {
        const res: unknown[] = [];

        while (true) {
            if (this.lexer.eat(TokenKind.SquareClose)) {
                return res;
            }

            const value = this.parseValue();
            res.push(value);

            if (!this.lexer.eat(TokenKind.Comma)) {
                this.lexer.expect(TokenKind.SquareClose);
                return res;
            }
        }
    }

    parseObjectKey() {
        const span = this.lexer.next();

        if (span.kind === TokenKind.QuoteDouble) {
            return this.parseString();
        }
        if (span.kind === TokenKind.QuoteSingle) {
            return this.parseString(false);
        }

        if (span.kind === TokenKind.Number) {
            const peek = this.lexer.peekWhitespace();
            if (peek.kind === TokenKind.Ident) {
                return span.raw() + this.lexer.next().raw();
            }
            return span.raw();
        }

        if (span.kind === TokenKind.Ident) {
            return span.raw();
        }

        if (span.kind === TokenKind.Backtick) {
            return this.parseEscaped("`");
        }

        if (span.kind === TokenKind.MathematicalOpen) {
            return this.parseEscaped("⟩");
        }

        throw new SurrealError(`Unexpected token: ${span.kind}, a valid object key`);
    }

    /**
     * Parses a string. Assumes that the opening quote is already consumed.
     */
    parseString(double = true): string {
        return this.parseEscaped(double ? '"' : "'");
    }

    // CharCode-based escape map for faster lookup
    private static readonly ESCAPE_MAP: Record<number, string> = {
        110: "\n",   // n
        116: "\t",   // t
        114: "\r",   // r
        92: "\\",    // \
        98: "\b",    // b
        102: "\f",   // f
        118: "\v",   // v
        48: "\0"     // 0
    };

    private parseEscapeSequence(escapedCode: number): string | null {
        return Parser.ESCAPE_MAP[escapedCode] ?? null;
    }

    parseIdent(span: Span) {
        if (span.kind === TokenKind.Ident) {
            return span.raw();
        }

        if (span.kind === TokenKind.Backtick) {
            return this.parseEscaped("`");
        }

        if (span.kind === TokenKind.MathematicalOpen) {
            return this.parseEscaped("⟩");
        }

        throw new SurrealError(`Unexpected token: ${span.kind}, a valid identifier`);
    }

    private parseEscaped(esc: string): string {
        // Fast path: check if there are any escape sequences
        const start = this.reader.positionWhitespace;
        const input = this.reader.input;
        const len = input.length;
        const escCode = esc.charCodeAt(0);
        let end = start;
        
        // Scan for closing quote or escape using charCodeAt
        while (end < len) {
            const c = input.charCodeAt(end);
            if (c === escCode) {
                // No escapes found - fast path
                this.reader.position = end + 1;
                return input.slice(start, end);
            }
            if (c === 92) { // backslash
                // Found escape - use slow path
                break;
            }
            end++;
        }
        
        // Slow path with escapes
        const parts: string[] = [];
        let pos = this.reader.positionWhitespace;

        while (pos < len) {
            const c = input.charCodeAt(pos);
            if (c === escCode) {
                this.reader.position = pos + 1;
                return parts.join("");
            }
            if (c === 92) { // backslash
                pos++;
                if (pos >= len) {
                    throw new SurrealError("Unexpected end of input");
                }
                const escapedCode = input.charCodeAt(pos);
                if (escapedCode === escCode) {
                    parts.push(esc);
                } else {
                    const char = this.parseEscapeSequence(escapedCode);
                    if (char !== null) {
                        parts.push(char);
                    } else {
                        throw new SurrealError(`Unknown escape sequence: \\${input[pos]}`);
                    }
                }
            } else {
                parts.push(input[pos]);
            }
            pos++;
        }

        throw new SurrealError("Unexpected end of input");
    }

    parseRecordString(double = true): RecordId {
        const record = this.parseRecord(this.lexer.next());
        this.lexer.expect(double ? TokenKind.QuoteDouble : TokenKind.QuoteSingle);
        return record;
    }

    parseRecord(span: Span) {
        const table = this.parseIdent(span);
        this.lexer.expect(TokenKind.Colon);
        const key = this.parseRecordKey();
        return new RecordId(table, key);
    }

    static parseRecord(input: string): RecordId {
        const parser = new Parser(input);
        const span = parser.lexer.next();
        return parser.parseRecord(span);
    }

    parseRecordKey() {
        const span = this.lexer.next();

        if (span.kind === TokenKind.Ident) {
            return span.raw();
        }

        if (span.kind === TokenKind.Backtick) {
            return this.parseEscaped("`");
        }

        if (span.kind === TokenKind.MathematicalOpen) {
            return this.parseEscaped("⟩");
        }

        if (span.kind === TokenKind.Number) {
            return Number(span.raw());
        }

        if (span.kind === TokenKind.BraceOpen) {
            return this.parseObject();
        }

        if (span.kind === TokenKind.SquareOpen) {
            return this.parseArray();
        }

        if (span.kind === TokenKind.UuidDouble) {
            return this.parseUuid();
        }

        if (span.kind === TokenKind.UuidSingle) {
            return this.parseUuid(false);
        }

        throw new SurrealError(`Unexpected token: ${span.kind}, a valid record key`);
    }

    parseUuid(double = true): Uuid {
        let uuid: Uuid;
        const pos = this.reader.positionWhitespace;
        const raw = this.reader.input.slice(pos, pos + 36);
        try {
            uuid = new Uuid(raw);
        } catch {
            throw new SurrealError(`Invalid UUID, found "${raw}"`);
        }

        // leftWhitespace already asserted there was no whitespace after the quote, so this addition is safe
        this.reader.position = pos + 36;
        this.lexer.expect(double ? TokenKind.QuoteDouble : TokenKind.QuoteSingle);
        return uuid;
    }

    parseDatetime(double = true): DateTime {
        const pos = this.reader.positionWhitespace;
        const input = this.reader.input;
        let endPos: number;
        
        // Check if it's a full datetime (has 'T') or just a date
        if (input[pos + 10] === "T") {
            // Find the 'Z' for full datetime
            endPos = input.indexOf("Z", pos + 11);
            if (endPos === -1) {
                throw new SurrealError("Invalid datetime format");
            }
            endPos += 1; // Include the 'Z'
        } else {
            endPos = pos + 10; // Just the date part
        }
        
        const raw = input.slice(pos, endPos);
        let datetime: DateTime;
        try {
            datetime = new DateTime(raw);
        } catch {
            throw new SurrealError(`Invalid datetime, found "${raw}"`);
        }

        this.reader.position = endPos;
        this.lexer.expect(double ? TokenKind.QuoteDouble : TokenKind.QuoteSingle);
        return datetime;
    }

    parseBytes(double = true): Uint8Array {
        const quoteCode = double ? 34 : 39; // " or '
        const bytes: number[] = [];
        const input = this.reader.input;
        const len = input.length;
        let pos = this.reader.positionWhitespace;

        while (pos < len) {
            const c = input.charCodeAt(pos);
            if (c === quoteCode) {
                this.reader.position = pos + 1;
                return new Uint8Array(bytes);
            }
            
            const high = c;
            pos++;
            if (pos >= len) {
                throw new SurrealError("Unexpected end of input");
            }
            const low = input.charCodeAt(pos);
            
            // Fast hex parsing without parseInt
            const h = high > 57 ? (high | 32) - 87 : high - 48;
            const l = low > 57 ? (low | 32) - 87 : low - 48;
            bytes.push((h << 4) | l);
            
            pos++;
        }

        throw new SurrealError("Unexpected end of input");
    }

    parseNumberLike(span: Span): number | Decimal | Duration {
        const spanRaw = span.raw();
        const pos = this.reader.positionWhitespace;
        this.reader.position = pos;
        
        // Check if it's a duration by looking ahead
        const input = this.reader.input;
        if (DURATION_PART_REGEX.test(input.slice(pos, pos + 20))) {
            return this.parseDuration();
        }

        let raw = spanRaw;
        this.reader.position = pos + spanRaw.length;
        if (this.lexer.eatWhitespace(TokenKind.Dot)) {
            raw += `.${this.lexer.expect(TokenKind.Number).raw()}`;
        }

        const peek = this.lexer.peekWhitespace();
        if (peek.kind === TokenKind.Ident) {
            const suffix = peek.raw();
            if (suffix.length === 3) {
                // Check for "dec" case-insensitively
                const c0 = suffix.charCodeAt(0) | 32;
                const c1 = suffix.charCodeAt(1) | 32;
                const c2 = suffix.charCodeAt(2) | 32;
                if (c0 === 100 && c1 === 101 && c2 === 99) { // 'd', 'e', 'c'
                    this.lexer.pop_peek();
                    return new Decimal(raw);
                }
            } else if (suffix.length === 1 && (suffix === "f" || suffix === "F")) {
                this.lexer.pop_peek();
            }
        }

        return Number(spanRaw);
    }

    parseDuration(): Duration {
        let seconds = 0n;
        let nanoseconds = 0n;

        // Loop through string and extract valid duration parts
        const input = this.reader.input;
        let pos = this.reader.positionWhitespace;
        
        while (pos < input.length) {
            const remaining = input.slice(pos, pos + 30); // Reasonable lookahead for duration part
            const match = remaining.match(DURATION_PART_REGEX);
            if (match) {
                const amount = BigInt(match[1]);
                const unit = match[2];
                const factor = UNITS.get(unit);
                if (!factor) throw new SurrealError(`Invalid duration unit: ${unit}`);

                if (factor >= SECOND) {
                    // Accumulate seconds
                    seconds += amount * (factor / SECOND);
                } else {
                    // Accumulate nanoseconds
                    nanoseconds += amount * factor;
                }

                // Move position forward
                pos += match[0].length;
            } else {
                break;
            }
        }

        this.reader.position = pos;
        
        // Normalize: convert overflow nanoseconds to seconds
        seconds += nanoseconds / SECOND;
        nanoseconds %= SECOND;
        return new Duration([seconds, nanoseconds]);
    }

    parseFile(double = true): FileRef {
        const parse_part = (slash_allowed: boolean): string => {
            let result = "";
            let peek = this.reader.peekWhitespace(true);
            while (true) {
                const code = peek.charCodeAt(0);

                if (
                    (code >= 48 && code <= 57) || // numeric (0-9)
                    (code >= 65 && code <= 90) || // upper alpha (A-Z)
                    (code >= 97 && code <= 122) || // lower alpha (a-z)
                    code === 95 || // underscore (_)
                    code === 45 || // dash (-)
                    code === 46 || // dot (.)
                    (!slash_allowed && code === 47) // slash (/) - only if not escaping slashes
                ) {
                    result += this.reader.nextWhitespace(true);
                } else if (peek === "\\") {
                    this.reader.nextWhitespace(true);
                    result += this.reader.nextWhitespace(true);
                } else {
                    return result;
                }

                peek = this.reader.peekWhitespace(true);
            }
        };
        const bucket = parse_part(false);

        this.lexer.expect(TokenKind.Colon);
        const key = parse_part(true);
        this.lexer.expect(double ? TokenKind.QuoteDouble : TokenKind.QuoteSingle);

        return new FileRef(bucket, key);
    }

    static parseFile(input: string): FileRef {
        const parser = new Parser(input);
        const span = parser.lexer.next();

        if (span.kind === TokenKind.FileDouble) {
            return parser.parseFile(true);
        }
        if (span.kind === TokenKind.FileSingle) {
            return parser.parseFile(false);
        }

        throw new SurrealError(`Unexpected token: ${span.kind}, a valid file`);
    }

    static parseValue(input: string): unknown {
        const parser = new Parser(input);
        return parser.parseValue();
    }
}

const string = `{ "key": "value" }`;

console.log("custom parser")
const stopA = Duration.measure();
for (let i = 0; i < 10000; i++) {
    Parser.parseValue(string);
}
console.log(stopA().toString());


console.log("\njson")
const stopB = Duration.measure();
for (let i = 0; i < 10000; i++) {
    JSON.parse(string);
}
console.log(stopB().toString());


