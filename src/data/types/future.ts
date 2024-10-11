import { Value } from "../value";

export class Future extends Value {
	constructor(readonly inner: string) {
		super();
	}

	equals(other: unknown): boolean {
		if (!(other instanceof Future)) return false;
		// TODO ignore whitespace
		return this.inner === other.inner;
	}

	toJSON(): string {
		return this.toString();
	}

	toString(): string {
		return `<future> { ${this.inner} }`;
	}
}
