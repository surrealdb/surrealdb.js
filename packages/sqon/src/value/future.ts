import { JsonCodec } from "../codec/json/codec.ts";
import { FUTURE_SYMBOL, hasSymbol, markSymbol } from "../utils/symbols.ts";
import { Value } from "./value.ts";

/**
 * An uncomputed SurrealQL future value.
 *
 * @deprecated Futures were removed in SurrealDB 3.0
 */
export class Future extends Value {
    static override [Symbol.hasInstance](instance: unknown): boolean {
        return hasSymbol(instance, FUTURE_SYMBOL);
    }

    private readonly _body: string;

    constructor(body: string) {
        super();
        this._body = body;
        markSymbol(this, FUTURE_SYMBOL);
    }

    equals(other: unknown): boolean {
        if (!(other instanceof Future)) return false;
        return this._body === other._body;
    }

    toJSON(): unknown {
        if (Value._useExperimentalToJson) {
            return JsonCodec.DEFAULT.encode(this);
        }
        return this.toString();
    }

    /**
     * @returns The uncomputed future notation
     */
    toString(): string {
        return `<future> ${this._body}`;
    }

    /**
     * The body of the future
     */
    get body(): string {
        return this._body;
    }
}
