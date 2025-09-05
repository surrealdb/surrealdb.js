import { Value } from "./value";

/**
 * An uncomputed SurrealQL future value.
 *
 * @deprecated Futures were removed in SurrealDB 3.0
 */
export class Future extends Value {
    readonly #body: string;

    constructor(body: string) {
        super();
        this.#body = body;
    }

    equals(other: unknown): boolean {
        if (!(other instanceof Future)) return false;
        return this.#body === other.#body;
    }

    toJSON(): string {
        return this.toString();
    }

    /**
     * @returns The uncomputed future notation
     */
    toString(): string {
        return `<future> ${this.#body}`;
    }

    /**
     * The body of the future
     */
    get body(): string {
        return this.#body;
    }
}
