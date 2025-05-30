import { Value } from "./value";

/**
 * An uncomputed SurrealQL future value.
 */
export class Future extends Value {
	public readonly inner: string;

	constructor(inner: string) {
		super();
		this.inner = inner;
	}

	equals(other: unknown): boolean {
		if (!(other instanceof Future)) return false;
		return this.inner === other.inner;
	}

	toJSON(): string {
		return this.toString();
	}

	toString(): string {
		return `<future> ${this.inner}`;
	}
}
