/**
 * A bound query represents a query string combined with bindings.
 */
export class BoundQuery {
    #query: string;
    #bindings: Record<string, unknown>;

    /**
     * Creates a new empty BoundQuery instance.
     */
    constructor(origin: BoundQuery);

    /**
     * Creates a new BoundQuery instance by cloning an existing instance.
     *
     * @param origin The BoundQuery to clone
     */
    constructor(origin: BoundQuery);

    /**
     * Creates a new BoundQuery instance.
     *
     * @param query The initial query string
     * @param bindings The initial bindings object
     */
    constructor(query: string, bindings?: Record<string, unknown>);

    // Shadow implementation
    constructor(query: string | BoundQuery, bindings?: Record<string, unknown>) {
        if (query instanceof BoundQuery) {
            this.#query = query.query;
            this.#bindings = { ...query.bindings };
        } else {
            this.#query = query;
            this.#bindings = { ...bindings };
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
    append(other: BoundQuery): this;

    /**
     * Append a query string and bindings to this one, ensuring no duplicate parameters.
     *
     * @param query The query string to append
     * @param bindings The bindings to append
     * @returns The current BoundQuery instance
     */
    append(query: string, bindings?: Record<string, unknown>): this;

    // Shadow implementation
    append(other: BoundQuery | string, bindings?: Record<string, unknown>): this {
        const _query = other instanceof BoundQuery ? other.query : other;
        const _bindings = other instanceof BoundQuery ? other.bindings : bindings;

        if (_bindings) {
            for (const key of Object.keys(_bindings)) {
                if (key in this.#bindings) {
                    throw new Error(
                        `Parameter conflict: '${key}' already exists in this BoundQuery`,
                    );
                }
            }

            Object.assign(this.#bindings, _bindings);
        }

        this.#query += _query;

        return this;
    }

    /**
     * Creates a new BoundQuery by combining this one with another. Unlike `append`, this method
     * will create a new instance.
     *
     * @param other The BoundQuery to combine with
     * @returns A new BoundQuery instance
     */
    combine(other: BoundQuery): BoundQuery {
        const combined = new BoundQuery(this.query, this.bindings);
        return combined.append(other);
    }
}
