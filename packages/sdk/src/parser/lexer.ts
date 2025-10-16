import { SurrealError } from "../errors";
import type { Reader } from "./reader"
import { TokenKind } from "./token";

export interface Span {
    kind: TokenKind;
    start: number;
    end: number;
    raw(): string;
}

// Character type lookup tables for ultra-fast categorization
const IDENT_START = new Uint8Array(256);
const IDENT_CONTINUE = new Uint8Array(256);
const DIGIT = new Uint8Array(256);

// Initialize lookup tables
for (let i = 65; i <= 90; i++) { // A-Z
    IDENT_START[i] = 1;
    IDENT_CONTINUE[i] = 1;
}
for (let i = 97; i <= 122; i++) { // a-z
    IDENT_START[i] = 1;
    IDENT_CONTINUE[i] = 1;
}
IDENT_START[95] = 1; // _
IDENT_CONTINUE[95] = 1; // _

for (let i = 48; i <= 57; i++) { // 0-9
    IDENT_CONTINUE[i] = 1;
    DIGIT[i] = 1;
}
DIGIT[95] = 1; // _ in numbers

export class Lexer {
    private readonly reader: Reader;
    #last_peek: Span | undefined = undefined;
    
    // Reusable span object to avoid allocations
    private readonly span: Span = {
        kind: TokenKind.BraceOpen,
        start: 0,
        end: 0,
        raw: () => this.reader.input.slice(this.span.start, this.span.end)
    };
    
    // Pre-allocated peek span with stable closure
    private readonly peekSpan: Span = {
        kind: TokenKind.BraceOpen,
        start: 0,
        end: 0,
        raw: () => this.reader.input.slice(this.peekSpan.start, this.peekSpan.end)
    };

    constructor(reader: Reader) {
        this.reader = reader;
    }


    peek(): Span {
        this.lex_position(this.peekSpan, this.reader.position);
        this.#last_peek = this.peekSpan;
        return this.peekSpan;
    }

    peekWhitespace(): Span {
        this.lex_position(this.peekSpan, this.reader.positionWhitespace);
        this.#last_peek = this.peekSpan;
        return this.peekSpan;
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
        this.lex_position(this.span, this.reader.position);
        this.reader.position = this.span.end;
        return this.span;
    }

    nextWhitespace(): Span {
        this.lex_position(this.span, this.reader.positionWhitespace);
        this.reader.position = this.span.end;
        return this.span;
    }

    // Optimized version: directly lex without peek state management
    eat(expected: TokenKind): boolean {
        this.lex_position(this.span, this.reader.position);
        if (this.span.kind === expected) {
            this.reader.position = this.span.end;
            return true;
        }
        return false;
    }

    eatWhitespace(expected: TokenKind): boolean {
        this.lex_position(this.span, this.reader.positionWhitespace);
        if (this.span.kind === expected) {
            this.reader.position = this.span.end;
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

    private lex_position(span: Span, position: number): void {
        const input = this.reader.input;
        
        if (position >= input.length) {
            throw new SurrealError("Unexpected end of input");
        }
        
        const code = input.charCodeAt(position);
    
        // Use charCode-based switch for maximum performance
        switch (code) {
            // Numbers: 0-9 (48-57)
            case 48: case 49: case 50: case 51: case 52:
            case 53: case 54: case 55: case 56: case 57:
                lex_number(span, this.reader, position);
                return;
            
            // { (123)
            case 123:
                span.kind = TokenKind.BraceOpen;
                span.start = position;
                span.end = position + 1;
                return;
            // } (125)
            case 125:
                span.kind = TokenKind.BraceClose;
                span.start = position;
                span.end = position + 1;
                return;
            // [ (91)
            case 91:
                span.kind = TokenKind.SquareOpen;
                span.start = position;
                span.end = position + 1;
                return;
            // ] (93)
            case 93:
                span.kind = TokenKind.SquareClose;
                span.start = position;
                span.end = position + 1;
                return;
            // : (58)
            case 58:
                span.kind = TokenKind.Colon;
                span.start = position;
                span.end = position + 1;
                return;
            // , (44)
            case 44:
                span.kind = TokenKind.Comma;
                span.start = position;
                span.end = position + 1;
                return;
            // " (34)
            case 34:
                span.kind = TokenKind.QuoteDouble;
                span.start = position;
                span.end = position + 1;
                return;
            // ' (39)
            case 39:
                span.kind = TokenKind.QuoteSingle;
                span.start = position;
                span.end = position + 1;
                return;
            // ` (96)
            case 96:
                span.kind = TokenKind.Backtick;
                span.start = position;
                span.end = position + 1;
                return;
            // . (46)
            case 46:
                span.kind = TokenKind.Dot;
                span.start = position;
                span.end = position + 1;
                return;
            // ⟨ (10216)
            case 10216:
                span.kind = TokenKind.MathematicalOpen;
                span.start = position;
                span.end = position + 1;
                return;
            // ⟩ (10217)
            case 10217:
                span.kind = TokenKind.MathematicalClose;
                span.start = position;
                span.end = position + 1;
                return;
            
            // s/S (115/83) - String prefix
            case 115: case 83: {
                const next = input.charCodeAt(position + 1);
                if (next === 34) { // "
                    span.kind = TokenKind.StringDouble;
                    span.start = position;
                    span.end = position + 2;
                    return;
                }
                if (next === 39) { // '
                    span.kind = TokenKind.StringSingle;
                    span.start = position;
                    span.end = position + 2;
                    return;
                }
                lex_ident(span, this.reader, position);
                return;
            }

            // b/B (98/66) - Bytes prefix
            case 98: case 66: {
                const next = input.charCodeAt(position + 1);
                if (next === 34) { // "
                    span.kind = TokenKind.BytesDouble;
                    span.start = position;
                    span.end = position + 2;
                    return;
                }
                if (next === 39) { // '
                    span.kind = TokenKind.BytesSingle;
                    span.start = position;
                    span.end = position + 2;
                    return;
                }
                lex_ident(span, this.reader, position);
                return;
            }
    
            // d/D (100/68) - DateTime prefix
            case 100: case 68: {
                const next = input.charCodeAt(position + 1);
                if (next === 34) { // "
                    span.kind = TokenKind.DatetimeDouble;
                    span.start = position;
                    span.end = position + 2;
                    return;
                }
                if (next === 39) { // '
                    span.kind = TokenKind.DatetimeSingle;
                    span.start = position;
                    span.end = position + 2;
                    return;
                }
                lex_ident(span, this.reader, position);
                return;
            }
            
            // u/U (117/85) - UUID prefix
            case 117: case 85: {
                const next = input.charCodeAt(position + 1);
                if (next === 34) { // "
                    span.kind = TokenKind.UuidDouble;
                    span.start = position;
                    span.end = position + 2;
                    return;
                }
                if (next === 39) { // '
                    span.kind = TokenKind.UuidSingle;
                    span.start = position;
                    span.end = position + 2;
                    return;
                }
                lex_ident(span, this.reader, position);
                return;
            }
    
            // r/R (114/82) - Record prefix
            case 114: case 82: {
                const next = input.charCodeAt(position + 1);
                if (next === 34) { // "
                    span.kind = TokenKind.RecordDouble;
                    span.start = position;
                    span.end = position + 2;
                    return;
                }
                if (next === 39) { // '
                    span.kind = TokenKind.RecordSingle;
                    span.start = position;
                    span.end = position + 2;
                    return;
                }
                lex_ident(span, this.reader, position);
                return;
            }

            // f/F (102/70) - File prefix
            case 102: case 70: {
                const next = input.charCodeAt(position + 1);
                if (next === 34) { // "
                    span.kind = TokenKind.FileDouble;
                    span.start = position;
                    span.end = position + 2;
                    return;
                }
                if (next === 39) { // '
                    span.kind = TokenKind.FileSingle;
                    span.start = position;
                    span.end = position + 2;
                    return;
                }
                lex_ident(span, this.reader, position);
                return;
            }
    
            default:
                lex_ident(span, this.reader, position);
                return;
        }
    }
}

function lex_ident(span: Span, reader: Reader, position: number): void {
    const input = reader.input;
    const len = input.length;
    const first = input.charCodeAt(position);
    
    // Check first char is [a-zA-Z_] using lookup table
    if (first >= 256 || !IDENT_START[first]) {
        throw new SurrealError("Expected identifier");
    }
    
    let end = position + 1;
    while (end < len) {
        const c = input.charCodeAt(end);
        // [a-zA-Z0-9_] using lookup table
        if (c < 256 && IDENT_CONTINUE[c]) {
            end++;
        } else {
            break;
        }
    }
    
    span.kind = TokenKind.Ident;
    span.start = position;
    span.end = end;
}

function lex_number(span: Span, reader: Reader, position: number): void {
    const input = reader.input;
    const len = input.length;
    let end = position;
    
    while (end < len) {
        const c = input.charCodeAt(end);
        // [0-9_] using lookup table
        if (c < 256 && DIGIT[c]) {
            end++;
        } else {
            break;
        }
    }
    
    if (end === position) {
        throw new SurrealError("Expected number");
    }
    
    span.kind = TokenKind.Number;
    span.start = position;
    span.end = end;
}