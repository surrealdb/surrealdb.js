import { ExpressionError } from "../errors";
import { surql } from "./tagged-template";

/**
 * A bound query represents a query string combined with bindings.
 */
export class BoundQuery<R extends unknown[] = unknown[]> {
    #query: string;
    #bindings: Record<string, unknown>;

    /**
     * Creates a new empty BoundQuery instance.
     */
    constructor();

    /**
     * Creates a new BoundQuery instance by cloning an existing instance.
     *
     * @param origin The BoundQuery to clone
     */
    constructor(origin: BoundQuery<R>);

    /**
     * Creates a new BoundQuery instance.
     *
     * @param query The initial query string
     * @param bindings The initial bindings object
     */
    constructor(query: string, bindings?: Record<string, unknown>);

    // Shadow implementation
    constructor(query?: string | BoundQuery<R>, bindings?: Record<string, unknown>) {
        if (query instanceof BoundQuery) {
            this.#query = query.query;
            this.#bindings = { ...query.bindings };
        } else if (query) {
            this.#query = query;
            this.#bindings = { ...bindings };
        } else {
            this.#query = "";
            this.#bindings = {};
        }
    }

    /**
     * Retrieves the query string.
     */
    get query(): string {
        return this.#query;
    }

    /**
     * Retrieves a copy of the configured bindings.
     */
    get bindings(): Record<string, unknown> {
        return { ...this.#bindings };
    }

    /**
     * Append another BoundQuery to this one, ensuring no duplicate parameters.
     *
     * @param other The BoundQuery to append
     * @returns The current BoundQuery instance
     */
    append(other: BoundQuery<R>): this;

    /**
     * Append a query string and bindings to this one, ensuring no duplicate parameters.
     *
     * @param query The query string to append
     * @param bindings The bindings to append
     * @returns The current BoundQuery instance
     */
    append(query: string, bindings?: Record<string, unknown>): this;

    /**
     * Append a query string and bindings through a template literal tags.
     * Interpolated values are automatically stored as bindings with unique names.
     *
     * @param strings The template string segments
     * @param values The interpolated values
     * @returns The current BoundQuery instance
     */
    append(strings: TemplateStringsArray, ...values: unknown[]): this;

    // Shadow implementation
    append(other: BoundQuery<R> | string | TemplateStringsArray, ...values: unknown[]): this {
        const _other = this.#extractQuery(other, values);

        if (_other.#bindings) {
            for (const key of Object.keys(_other.#bindings)) {
                if (key in this.#bindings) {
                    throw new ExpressionError(
                        `Parameter conflict: '${key}' already exists in this BoundQuery`,
                    );
                }
            }

            Object.assign(this.#bindings, _other.#bindings);
        }

        this.#query += _other.query;

        return this;
    }

    #extractQuery(
        other: BoundQuery<R> | string | TemplateStringsArray,
        values: unknown[],
    ): BoundQuery<R> {
        if (other instanceof BoundQuery) {
            return other;
        }

        if (typeof other === "string") {
            return new BoundQuery(other, values[0] as Record<string, unknown>);
        }

        if (Array.isArray(other)) {
            return surql(other, ...values);
        }

        throw new ExpressionError("Invalid query component");
    }
}
