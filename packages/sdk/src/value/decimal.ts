import { Value } from "./value";

/**
 * A SurrealQL decimal value.
 */
export class Decimal extends Value {
	readonly decimal: string;

	constructor(decimal: string | number | bigint | Decimal) {
		super();
		this.decimal = decimal.toString();
	}

	equals(other: unknown): boolean {
		if (!(other instanceof Decimal)) return false;
		return this.decimal === other.decimal;
	}

	toBigInt(): bigint {
		return BigInt(this.decimal);
	}

	toString(): string {
		return this.decimal;
	}

	toJSON(): string {
		return this.decimal;
	}
}
