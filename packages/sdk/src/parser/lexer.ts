import { SurrealError } from "../errors";
import type { Reader } from "./reader"
import { TokenKind } from "./token";

export class Span {
    #reader: Reader;
    #kind: TokenKind;
    #start: number;
    #end: number;

    constructor(reader: Reader, kind: TokenKind, start: number, end: number) {
        this.#reader = reader;
        this.#kind = kind;
        this.#start = start;
        this.#end = end;
    }

    get kind() {
        return this.#kind;
    }

    get start() {
        return this.#start;
    }

    get end() {
        return this.#end;
    }

    raw() {
        return this.#reader.input.slice(this.#start, this.#end);
    }
}

export class Lexer {
    private readonly reader: Reader;
    #last_peek: Span | undefined = undefined;

    constructor(reader: Reader) {
        this.reader = reader;
    }


    peek(): Span {
        this.#last_peek = this.lex_position(this.reader.position);
        return this.#last_peek;
    }

    peekWhitespace(): Span {
        this.#last_peek = this.lex_position(this.reader.positionWhitespace);
        return this.#last_peek;
    }

    pop_peek(): Span | undefined {
        const span = this.#last_peek;
        this.#last_peek = undefined;
        this.reader.position = span?.end ?? this.reader.position;
        return span;
    }

    get last_peek() {
        return this.#last_peek;
    }

    next(): Span {
        const span = this.lex_position(this.reader.position);
        this.reader.position = span.end;
        return span;
    }

    nextWhitespace(): Span {
        const span = this.lex_position(this.reader.positionWhitespace);
        this.reader.position = span.end;
        return span;
    }

    eat(expected: TokenKind): boolean {
        const span = this.peek();
        if (span.kind === expected) {
            this.next();
            return true;
        }
        return false;
    }

    eatWhitespace(expected: TokenKind): boolean {
        const span = this.peekWhitespace();
        if (span.kind === expected) {
            this.nextWhitespace();
            return true;
        }
        return false;
    }

    expect(expected: TokenKind): Span {
        const span = this.next();
        if (span.kind === expected) {
            return span;
        }
        throw new SurrealError(`Expected ${expected}, got ${span.kind}`);
    }

    expectWhitespace(expected: TokenKind): Span {
        const span = this.nextWhitespace();
        if (span.kind === expected) {
            return span;
        }
        throw new SurrealError(`Expected ${expected}, got ${span.kind}`);
    }

    private lex_position(position: number): Span {
        const peek = this.reader.input[position];
        if (peek === undefined) {
            throw new SurrealError("Unexpected end of input");
        }
    
        switch (peek.toLowerCase()) {
            case "{":
                return new Span(this.reader, TokenKind.BraceOpen, position, position + 1);
            case "}":
                return new Span(this.reader, TokenKind.BraceClose, position, position + 1);
            case "[":
                return new Span(this.reader, TokenKind.SquareOpen, position, position + 1);
            case "]":
                return new Span(this.reader, TokenKind.SquareClose, position, position + 1);
            case ":":
                return new Span(this.reader, TokenKind.Colon, position, position + 1);
            case ",":
                return new Span(this.reader, TokenKind.Comma, position, position + 1);
    
            case '"':
                return new Span(this.reader, TokenKind.QuoteDouble, position, position + 1);
            case "'":
                return new Span(this.reader, TokenKind.QuoteSingle, position, position + 1);
    
            case "s": {
                const next = this.reader.input[position + 1];
                if (next === '"') {
                    return new Span(this.reader, TokenKind.StringDouble, position, position + 2);
                }
                if (next === "'") {
                    return new Span(this.reader, TokenKind.StringSingle, position, position + 2);
                }
                return lex_ident(this.reader, position);
            }

            case "b": {
                const next = this.reader.input[position + 1];
                if (next === '"') {
                    return new Span(this.reader, TokenKind.BytesDouble, position, position + 2);
                }
                if (next === "'") {
                    return new Span(this.reader, TokenKind.BytesSingle, position, position + 2);
                }
                return lex_ident(this.reader, position);
            }
    
            case "d": {
                const next = this.reader.input[position + 1];
                if (next === '"') {
                    return new Span(this.reader, TokenKind.DatetimeDouble, position, position + 2);
                }
                if (next === "'") {
                    return new Span(this.reader, TokenKind.DatetimeSingle, position, position + 2);
                }
                return lex_ident(this.reader, position);
            }
            
            case "u": {
                const next = this.reader.input[position + 1];
                if (next === '"') {
                    return new Span(this.reader, TokenKind.UuidDouble, position, position + 2);
                }
                if (next === "'") {
                    return new Span(this.reader, TokenKind.UuidSingle, position, position + 2);
                }
                return lex_ident(this.reader, position);
            }
    
            case "r": {
                const next = this.reader.input[position + 1];
                if (next === '"') {
                    return new Span(this.reader, TokenKind.RecordDouble, position, position + 2);
                }
                if (next === "'") {
                    return new Span(this.reader, TokenKind.RecordSingle, position, position + 2);
                }
                return lex_ident(this.reader, position);
            }

            case "f": {
                const next = this.reader.input[position + 1];
                if (next === '"') {
                    return new Span(this.reader, TokenKind.FileDouble, position, position + 2);
                }
                if (next === "'") {
                    return new Span(this.reader, TokenKind.FileSingle, position, position + 2);
                }
                return lex_ident(this.reader, position);
            }
    
            case "`":
                return new Span(this.reader, TokenKind.Backtick, position, position + 1);
            case "⟨":
                return new Span(this.reader, TokenKind.MathematicalOpen, position, position + 1);
            case "⟩":
                return new Span(this.reader, TokenKind.MathematicalClose, position, position + 1);

            case ".":
                return new Span(this.reader, TokenKind.Dot, position, position + 1);
    
            default: {
                const char = peek.charCodeAt(0);
                if (char >= 48 && char <= 57) {
                    return lex_number(this.reader, position);
                } else {
                    return lex_ident(this.reader, position)
                }
            }
        }
    }
}

function lex_ident(reader: Reader, position: number): Span {
    const left = reader.input.slice(position);
    const match = left.match(/^[a-zA-Z_][a-zA-Z0-9_]*/i);
    if (match) {
        return new Span(reader, TokenKind.Ident, position, position + match[0].length);
    }

    throw new SurrealError("Expected identifier");
}

function lex_number(reader: Reader, position: number): Span {
    const left = reader.input.slice(position);
    const match = left.match(/^[\d_]+/);
    if (match) {
        return new Span(reader, TokenKind.Number, position, position + match[0].length);
    }

    throw new SurrealError("Expected number");
}