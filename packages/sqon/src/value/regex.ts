import { JsonCodec } from "../codec/json/codec.ts";
import { InvalidRegexError } from "../errors.ts";
import { hasSymbol, markSymbol, REGEX_SYMBOL } from "../utils/symbols.ts";
import { Value } from "./value.ts";

/**
 * A SurrealQL `regex`: the text of a pattern in the syntax SurrealQL regexes use, that of the
 * Rust `regex` crate. It is not a JavaScript `RegExp`, whose syntax differs, so the SDK never
 * converts between them; {@link Regex.toRegExp} compiles the pattern with JavaScript's engine
 * when the pattern means the same in both.
 *
 * A `cbor.2` connection reads a `regex` as a `Regex` and sends one as tag 193. Plain `cbor`
 * has no regex, and the server refuses to send one over it.
 */
export class Regex extends Value {
    static override [Symbol.hasInstance](instance: unknown): boolean {
        return hasSymbol(instance, REGEX_SYMBOL);
    }

    /** The pattern, without delimiters */
    readonly pattern: string;

    constructor(pattern: string | Regex) {
        super();

        if (pattern instanceof Regex) {
            this.pattern = pattern.pattern;
        } else if (typeof pattern === "string") {
            this.pattern = pattern;
        } else {
            throw new InvalidRegexError("A regex is made from the text of its pattern");
        }

        markSymbol(this, REGEX_SYMBOL);
    }

    /**
     * The pattern compiled by JavaScript's engine. Its syntax is close to, but not the same as,
     * the Rust `regex` crate's which the server uses.
     */
    toRegExp(flags?: string): RegExp {
        return new RegExp(this.pattern, flags);
    }

    equals(other: unknown): boolean {
        return other instanceof Regex && other.pattern === this.pattern;
    }

    toJSON(): unknown {
        if (Value._useExperimentalToJson) {
            return JsonCodec.DEFAULT.encode(this);
        }
        return this.toString();
    }

    /**
     * The regex as SurrealQL writes it: `/pattern/`, with each `/` escaped
     */
    toString(): string {
        return `/${this.pattern.replaceAll("/", "\\/")}/`;
    }
}
