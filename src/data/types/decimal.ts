export class Decimal {
	readonly decimal: string;

	constructor(decimal: string | number | Decimal) {
		this.decimal = decimal.toString();
	}

	toString() {
		return this.decimal;
	}

	toJSON() {
		return this.decimal;
	}
}
