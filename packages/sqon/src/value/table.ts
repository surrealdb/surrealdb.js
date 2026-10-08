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

    private readonly _name: Tb;

    constructor(tb: Tb) {
        super();
        if (typeof tb !== "string") throw new InvalidTableError("Table must be a string");
        this._name = tb;
        markSymbol(this, TABLE_SYMBOL);
    }

    equals(other: unknown): boolean {
        if (!(other instanceof Table)) return false;
        return this._name === other._name;
    }

    toJSON(): unknown {
        if (Value._useExperimentalToJson) {
            return JsonCodec.DEFAULT.encode(this);
        }
        return this.toString();
    }

    /**
     * @returns The escaped table name
     */
    toString(): string {
        return escapeIdent(this._name);
    }

    /**
     * The unescaped table name
     */
    get name(): Tb {
        return this._name;
    }
}
