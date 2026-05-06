import { FUTURE_SYMBOL, isFuture, markSymbol } from "../utils/symbols";
import { Value } from "./value";

/**
 * An uncomputed SurrealQL future value.
 *
 * @deprecated Futures were removed in SurrealDB 3.0
 */
export class Future extends Value {
    readonly body: string;

    constructor(body: string) {
        super();
        this.body = body;
        markSymbol(this, FUTURE_SYMBOL);
    }

    equals(other: unknown): boolean {
        if (!isFuture(other)) return false;
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
