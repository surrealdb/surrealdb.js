// Why is the default value being stored in an array? undefined, null, false, etc... are all valid defaults,
// and specifying a field on a class as optional will make it undefined by default.

/**
 * Represents a Gap and its intended value.
 */
export type Fill<T = unknown> = [Gap<T>, T];

/**
 * A Gap represents a placeholder value that can be filled
 * at a later point in time.
 */
export class Gap<T = unknown> {
	readonly args: [T?] = [];
	constructor(...args: [T?]) {
		this.args = args;
	}

	fill(value: T): Fill<T> {
		return [this, value];
	}

	hasDefault(): boolean {
		return this.args.length === 1;
	}

	get default(): T | undefined {
		return this.args[0];
	}
}
