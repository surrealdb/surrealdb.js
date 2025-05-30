/**
 * Represents a range bound which includes the value within the range
 */
export class BoundIncluded<T> {
	constructor(readonly value: T) {}
}

/**
 * Represents a range bound which excludes the value from the range
 */
export class BoundExcluded<T> {
	constructor(readonly value: T) {}
}

/**
 * Represents a Bound which can represent the start or end of a range
 */
export type Bound<T> = BoundIncluded<T> | BoundExcluded<T> | undefined;
