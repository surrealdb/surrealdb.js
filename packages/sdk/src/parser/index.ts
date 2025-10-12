import { SurrealError } from "../errors";
import { toSurrealqlString } from "../utils";
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

            case TokenKind.Ident:
                switch (span.raw().toLowerCase()) {
                    case "true":
                        return true;
                    case "false":
                        return false;
                    case "null":
                        return null;
                    case "none":
                        return undefined;
                    default:
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
        const res: Record<string, unknown> = {};

        while (true) {
            if (this.lexer.peek().kind === TokenKind.BraceClose) {
                this.lexer.pop_peek();
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
            if (this.lexer.peek().kind === TokenKind.SquareClose) {
                this.lexer.pop_peek();
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
            let key = span.raw();
            if (this.lexer.peekWhitespace().kind === TokenKind.Ident) {
                key += this.lexer.next().raw();
            }
            return key;
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

    private parseEscapeSequence(escaped: string): Option<string> {
        switch (escaped) {
            case "n":
                return Option.some("\n");
            case "t":
                return Option.some("\t");
            case "r":
                return Option.some("\r");
            case "\\":
                return Option.some("\\");
            case "b":
                return Option.some("\b");
            case "f":
                return Option.some("\f");
            case "v":
                return Option.some("\v");
            case "0":
                return Option.some("\0");
            default: {
                return Option.none();
            }
        }
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
        let res = "";
        let next = this.reader.next(true);

        while (next !== esc) {
            if (next === "\\") {
                const escaped = this.reader.next(true);
                if (escaped === esc) {
                    res += esc;
                } else {
                    const char = this.parseEscapeSequence(escaped);
                    if (char.is_some()) {
                        res += char.value;
                    } else {
                        throw new SurrealError(`Unknown escape sequence: \\${escaped}`);
                    }
                }
            } else {
                res += next;
            }

            next = this.reader.next(true);
        }

        return res;
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
        const raw = this.reader.leftWhitespace.slice(0, 36);
        try {
            uuid = new Uuid(raw);
        } catch {
            throw new SurrealError(`Invalid UUID, found "${raw}"`);
        }

        // leftWhitespace already asserted there was no whitespace after the quote, so this addition is safe
        this.reader.position += 36;
        this.lexer.expect(double ? TokenKind.QuoteDouble : TokenKind.QuoteSingle);
        return uuid;
    }

    parseDatetime(double = true): DateTime {
        const left = this.reader.leftWhitespace;
        const raw = left[10] === "T" ? left.slice(0, left.indexOf("Z") + 1) : left.slice(0, 10);

        let datetime: DateTime;
        try {
            datetime = new DateTime(raw);
        } catch {
            throw new SurrealError(`Invalid datetime, found "${raw}"`);
        }

        this.reader.position += raw.length;
        this.lexer.expect(double ? TokenKind.QuoteDouble : TokenKind.QuoteSingle);
        return datetime;
    }

    parseBytes(double = true): Uint8Array {
        const quote = double ? '"' : "'";
        const bytes: number[] = [];

        let next = this.reader.next(true);
        while (next !== quote) {
            const byte = `${next}${this.reader.next(true)}`;
            bytes.push(parseInt(byte, 16));
            next = this.reader.next(true);
        }

        return new Uint8Array(bytes);
    }

    parseNumberLike(span: Span): number | Decimal | Duration {
        this.reader.position -= span.raw().length;
        if (this.reader.leftWhitespace.match(DURATION_PART_REGEX)) {
            return this.parseDuration();
        }

        let raw = span.raw();
        this.reader.position += span.raw().length;
        if (this.lexer.eatWhitespace(TokenKind.Dot)) {
            raw += `.${this.lexer.expect(TokenKind.Number).raw()}`;
        }

        const peek = this.lexer.peekWhitespace();
        if (peek.kind === TokenKind.Ident) {
            const suffix = peek.raw().toLowerCase();
            if (suffix === "dec") {
                this.lexer.pop_peek();
                return new Decimal(raw);
            }

            if (suffix === "f") {
                this.lexer.pop_peek();
            }
        }

        return Number(span.raw());
    }

    parseDuration(): Duration {
        let seconds = 0n;
        let nanoseconds = 0n;

        // Loop through string and extract valid duration parts
        while (this.reader.leftWhitespace !== "") {
            const match = this.reader.leftWhitespace.match(DURATION_PART_REGEX);
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

                // Slice the processed segment off
                this.reader.position += match[0].length;
            } else {
                break;
            }
        }

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
}

const stop = Duration.measure();
const value = Parser.parseFile(`f"bucket:key"`);
console.log(stop().toString());

console.log(toSurrealqlString(value));
