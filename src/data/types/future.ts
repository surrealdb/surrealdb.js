export class Future {
	constructor(readonly inner: string) {}

	toJSON(): string {
		return this.toString();
	}

	toString(): string {
		return `<future> { ${this.inner} }`;
	}
}
