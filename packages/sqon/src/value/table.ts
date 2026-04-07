import { JsonCodec } from "../codec/json/codec.ts";
import { InvalidTableError } from "../errors.ts";
import { escapeIdent } from "../utils/escape.ts";
import { hasSymbol, markSymbol, TABLE_SYMBOL } from "../utils/symbols.ts";
import { Value } from "./value.ts";

/**
 * A SurrealQL table value.
 */
export class Table<Tb extends string = string> extends Value {
    static override [Symbol.hasInstance](instance: unknown): boolean {
        return hasSymbol(instance, TABLE_SYMBOL);
    }

    readonly #name: Tb;

    constructor(tb: Tb) {
        super();
        if (typeof tb !== "string") throw new InvalidTableError("Table must be a string");
        this.#name = tb;
        markSymbol(this, TABLE_SYMBOL);
    }

    equals(other: unknown): boolean {
        if (!(other instanceof Table)) return false;
        return this.#name === other.#name;
    }

    toJSON(): unknown {
        if (Value.useExperimentalToJson) {
            return JsonCodec.default.encode(this);
        }
        return this.toString();
    }

    /**
     * @returns The escaped table name
     */
    toString(): string {
        return escapeIdent(this.#name);
    }

    /**
     * The unescaped table name
     */
    get name(): Tb {
        return this.#name;
    }
}
