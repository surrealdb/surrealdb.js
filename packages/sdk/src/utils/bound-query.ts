/**
 * A bound query represents a query string combined with bindings.
 */
export class BoundQuery {
	#query: string;
	#bindings: Record<string, unknown>;

	/**
	 * Creates a new BoundQuery instance.
	 * @param query - The initial query string
	 * @param bindings - The initial bindings object
	 */
	constructor(query: string = "", bindings: Record<string, unknown> = {}) {
		this.#query = query;
		this.#bindings = { ...bindings };
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
	append(other: BoundQuery): this {
		for (const key of Object.keys(other.bindings)) {
			if (key in this.#bindings) {
				throw new Error(`Parameter conflict: '${key}' already exists in this BoundQuery`);
			}
		}

		this.#query += other.query;
		Object.assign(this.#bindings, other.bindings);

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
