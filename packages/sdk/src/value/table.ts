import { InvalidTableError } from "../errors";
import { escapeIdent } from "../utils";
import { hasSymbol, markSymbol, TABLE_SYMBOL } from "../utils/symbols";
import { Value } from "./value";

/**
 * A SurrealQL table value.
 */
export class Table<Tb extends string = string> extends Value {
    static override [Symbol.hasInstance](instance: unknown): boolean {
        return hasSymbol(instance, TABLE_SYMBOL);
    }

    readonly name: Tb;

    constructor(tb: Tb) {
        super();
        if (typeof tb !== "string") throw new InvalidTableError("Table must be a string");
        this.name = tb;
        markSymbol(this, TABLE_SYMBOL);
    }

    equals(other: unknown): boolean {
        if (!(other instanceof Table)) return false;
        return this.name === (other as unknown as Table).name;
    }

    toJSON(): string {
        return this.toString();
    }

    /**
     * @returns The escaped table name
     */
    toString(): string {
        return escapeIdent(this.name);
    }
}
