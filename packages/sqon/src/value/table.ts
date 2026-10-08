import { JsonCodec } from "../codec/json/codec.ts";
import { InvalidTableError } from "../errors.ts";
import { escapeIdent } from "../utils/escape.ts";
import { hasSymbol, markSymbol, TABLE_SYMBOL } from "../utils/symbols.ts";
import { Value } from "./value.ts";

/**
 * Type-only key carrying a table's record type. It has no runtime presence.
 */
declare const RECORD_TYPE: unique symbol;

/**
 * A SurrealQL table value.
 *
 * @typeParam Tb The table name, as a string literal type
 * @typeParam T The type of the records stored in the table. This is a compile-time
 * annotation only: it is not validated against the data returned by the server.
 *
 * @internal
 */
class Table<Tb extends string = string, T = unknown> extends Value {
    static override [Symbol.hasInstance](instance: unknown): boolean {
        return hasSymbol(instance, TABLE_SYMBOL);
    }

    /**
     * Declares the record type of a table, while inferring its name.
     *
     * @example
     * ```ts
     * const users = Table.of<User>()("users"); // Table<"users", User>
     * ```
     */
    static of<T>(): <Tb extends string>(tb: Tb) => Table<Tb, T> {
        return <Tb extends string>(tb: Tb) => new Table<Tb, T>(tb);
    }

    declare readonly [RECORD_TYPE]?: T;

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

interface TableConstructor {
    /**
     * Create a table reference, keeping the table name as a literal type.
     *
     * The record type can be declared with a type annotation:
     *
     * @example
     * ```ts
     * const users: Table<"users", User> = new Table("users");
     * ```
     */
    // biome-ignore lint/correctness/noUnusedVariables: T is used in the return type
    new <Tb extends string, T = unknown>(tb: Tb): Table<Tb, T>;

    /**
     * Create a table reference with a record type, as in `new Table<User>("users")`.
     *
     * Note that the table name is only typed as `string` in this form. To also keep
     * the name as a literal type, use `Table.of<User>()("users")`, or pass both type
     * arguments: `new Table<"users", User>("users")`.
     */
    new <T>(tb: string): Table<string, T>;

    readonly of: typeof Table.of;
}

/**
 * A SurrealQL table value.
 *
 * @typeParam Tb The table name, as a string literal type
 * @typeParam T The type of the records stored in the table. This is a compile-time
 * annotation only: it is not validated against the data returned by the server.
 */
type _Table<Tb extends string = string, T = unknown> = Table<Tb, T>;
const _Table = Table as unknown as TableConstructor;

export { _Table as Table };
