export class Decimal {
	readonly decimal: string;

	constructor(decimal: string | number | Decimal) {
		this.decimal = decimal.toString();
	}

	toString(): string {
		return this.decimal;
	}

	toJSON(): string {
		return this.decimal;
	}
}
