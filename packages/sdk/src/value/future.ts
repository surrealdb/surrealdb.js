import { FUTURE_SYMBOL, hasSymbol, markSymbol } from "../utils/symbols";
import { Value } from "./value";

/**
 * An uncomputed SurrealQL future value.
 *
 * @deprecated Futures were removed in SurrealDB 3.0
 */
export class Future extends Value {
    static override [Symbol.hasInstance](instance: unknown): boolean {
        return hasSymbol(instance, FUTURE_SYMBOL);
    }

    readonly body: string;

    constructor(body: string) {
        super();
        this.body = body;
        markSymbol(this, FUTURE_SYMBOL);
    }

    equals(other: unknown): boolean {
        if (!(other instanceof Future)) return false;
        return this.body === (other as unknown as Future).body;
    }

    toJSON(): string {
        return this.toString();
    }

    /**
     * @returns The uncomputed future notation
     */
    toString(): string {
        return `<future> ${this.body}`;
    }
}
