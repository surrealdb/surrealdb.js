import { SurrealError } from "../errors";
import { Option } from "./option";

// Whitespace lookup table for fast checking (space, tab, newline, carriage return)
const WHITESPACE_TABLE = new Uint8Array(256);
WHITESPACE_TABLE[32] = 1;  // space
WHITESPACE_TABLE[9] = 1;   // tab
WHITESPACE_TABLE[10] = 1;  // newline
WHITESPACE_TABLE[13] = 1;  // carriage return

export class Reader {
    readonly input: string;
    #position: number;
    #cachedPos: number = -1;
    #cachedNonWs: number = -1;

    constructor(input: string) {
        this.input = input;
        this.#position = 0;
    }

    try<T extends TryPattern[]>(...pat: T): Option<TryOutput<T>> {
        for (const [regex, fn] of pat) {
            const match = this.left.match(regex);
            if (match) {
                this.#position = this.position + match[0].length;
                return Option.some(fn(...match) as TryOutput<T>);
            }
        }
        return Option.none();
    }

    tryWhitespace<T extends TryPattern[]>(...pat: T): Option<TryOutput<T>> {
        for (const [regex, fn] of pat) {
            const match = this.leftWhitespace.match(regex);
            if (match) {
                this.#position = this.positionWhitespace + match[0].length;
                return Option.some(fn(...match) as TryOutput<T>);
            }
        }
        return Option.none();
    }

    peek(required: true): string;
    peek(required: false): string | undefined;
    peek(required = true): string | undefined {
        if (required && this.position >= this.input.length) {
            throw new SurrealError("Unexpected end of input");
        }
        const peek = this.input[this.position];
        if (required && peek === undefined) {
            throw new SurrealError("Unexpected end of input");
        }
        return peek;
    }

    peekWhitespace(required: true): string;
    peekWhitespace(required: false): string | undefined;
    peekWhitespace(required = true): string | undefined {
        const peek = this.input[this.positionWhitespace];
        if (required && peek === undefined) {
            throw new SurrealError("Unexpected end of input");
        }
        return this.input[this.positionWhitespace];
    }

    next(required: true): string;
    next(required: false): string | undefined;
    next(required = true): string | undefined {
        const pos = this.position;
        const char = this.input[pos];
        if (required && char === undefined) {
            throw new SurrealError("Unexpected end of input");
        }
        this.#position = pos + 1;
        return char;
    }

    nextWhitespace(required: true): string;
    nextWhitespace(required: false): string | undefined;
    nextWhitespace(required = true): string | undefined {
        const pos = this.positionWhitespace;
        const char = this.input[pos];
        if (required && char === undefined) {
            throw new SurrealError("Unexpected end of input");
        }
        this.#position = pos + 1;
        return char;
    }

    eat(expected: string): boolean {
        const pos = this.position;
        const char = this.input[pos];
        if (char === expected) {
            this.#position = pos + 1;
            return true;
        }
        return false;
    }

    eatWhitespace(expected: string): boolean {
        const pos = this.positionWhitespace;
        const char = this.input[pos];
        if (char === expected) {
            this.#position = pos + 1;
            return true;
        }
        return false;
    }

    expect(expected: string) {
        const pos = this.position;
        const char = this.input[pos];
        if (char === expected) {
            this.#position = pos + 1;
        } else {
            throw new SurrealError(`Expected ${expected}, got ${char}`);
        }
    }

    expectWhitespace(expected: string) {
        const pos = this.positionWhitespace;
        const char = this.input[pos];
        if (char === expected) {
            this.#position = pos + 1;
        } else {
            throw new SurrealError(`Expected ${expected}, got ${char}`);
        }
    }

    get position(): number {
        if (this.#cachedPos === this.#position) {
            return this.#cachedNonWs;
        }
        this.#cachedPos = this.#position;
        this.#cachedNonWs = this.findNonWhitespace(this.#position);
        return this.#cachedNonWs;
    }

    set position(pos: number) {
        this.#position = pos;
        // Invalidate cache
        this.#cachedPos = -1;
    }

    get positionWhitespace(): number {
        return this.#position;
    }

    get left(): string {
        return this.input.slice(this.position);
    }

    get leftWhitespace(): string {
        return this.input.slice(this.positionWhitespace);
    }

    private findNonWhitespace(pos: number): number {
        const len = this.input.length;
        const input = this.input;
        while (pos < len) {
            const code = input.charCodeAt(pos);
            if (code >= 256 || !WHITESPACE_TABLE[code]) {
                return pos;
            }
            pos++;
        }
        return pos;
    }
}

export function c(arg: TemplateStringsArray): number {
    return arg[0].charCodeAt(0);
}

type TryPattern = [RegExp, (...args: string[]) => unknown];
type TryOutput<T extends TryPattern[]> = ReturnType<T[number][1]>;
