import { SurrealError } from "../errors";
import { Option } from "./option";

export class Reader {
    readonly input: string;
    #position: number;

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
        return this.findNonWhitespace(this.#position);
    }

    set position(pos: number) {
        this.#position = pos;
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
        return (
            pos +
            this.input
                .slice(pos)
                .split("")
                .findIndex(
                    (c) =>
                        c !== " " && // space
                        c !== "\t" && // tab
                        c !== "\n" && // newline
                        c !== "\r", // carriage return
                )
        );
    }
}

export function c(arg: TemplateStringsArray): number {
    return arg[0].charCodeAt(0);
}

type TryPattern = [RegExp, (...args: string[]) => unknown];
type TryOutput<T extends TryPattern[]> = ReturnType<T[number][1]>;
