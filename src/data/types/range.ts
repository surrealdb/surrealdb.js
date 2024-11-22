import { Tagged } from "../../cbor";
import { SurrealDbError } from "../../errors";
import { equals } from "../../util/equals";
import { escapeIdent } from "../../util/escape";
import { toSurrealqlString } from "../../util/to-surrealql-string";
import { TAG_BOUND_EXCLUDED, TAG_BOUND_INCLUDED } from "../cbor";
import { Value } from "../value";
import { type RecordIdValue, escapeIdPart, isValidIdPart } from "./recordid";

/**
 * A SurrealQL range value.
 */
export class Range<Beg, End> extends Value {
	constructor(
		readonly beg: Bound<Beg>,
		readonly end: Bound<End>,
	) {
		super();
	}

	equals(other: unknown): boolean {
		if (!(other instanceof Range)) return false;
		if (this.beg?.constructor !== other.beg?.constructor) return false;
		if (this.end?.constructor !== other.end?.constructor) return false;
		return (
			equals(this.beg?.value, other.beg?.value) &&
			equals(this.end?.value, other.end?.value)
		);
	}

	toJSON(): string {
		return this.toString();
	}

	toString(): string {
		const beg = escapeRangeBound(this.beg);
		const end = escapeRangeBound(this.end);
		return `${beg}${getRangeJoin(this.beg, this.end)}${end}`;
	}
}

export type Bound<T> = BoundIncluded<T> | BoundExcluded<T> | undefined;
export class BoundIncluded<T> {
	constructor(readonly value: T) {}
}

export class BoundExcluded<T> {
	constructor(readonly value: T) {}
}

/**
 * A SurrealQL record ID range value.
 */
export class RecordIdRange<Tb extends string = string> extends Value {
	constructor(
		public readonly tb: Tb,
		public readonly beg: Bound<RecordIdValue>,
		public readonly end: Bound<RecordIdValue>,
	) {
		super();
		if (typeof tb !== "string")
			throw new SurrealDbError("TB part is not valid");
		if (!isValidIdBound(beg)) throw new SurrealDbError("Beg part is not valid");
		if (!isValidIdBound(end)) throw new SurrealDbError("End part is not valid");
	}

	equals(other: unknown): boolean {
		if (!(other instanceof RecordIdRange)) return false;
		if (this.beg?.constructor !== other.beg?.constructor) return false;
		if (this.end?.constructor !== other.end?.constructor) return false;
		return (
			this.tb === other.tb &&
			equals(this.beg?.value, other.beg?.value) &&
			equals(this.end?.value, other.end?.value)
		);
	}

	toJSON(): string {
		return this.toString();
	}

	toString(): string {
		const tb = escapeIdent(this.tb);
		const beg = escapeIdBound(this.beg);
		const end = escapeIdBound(this.end);
		return `${tb}:${beg}${getRangeJoin(this.beg, this.end)}${end}`;
	}
}

function getRangeJoin(beg: Bound<unknown>, end: Bound<unknown>): string {
	let output = "";
	if (beg instanceof BoundExcluded) output += ">";
	output += "..";
	if (end instanceof BoundIncluded) output += "=";
	return output;
}

function isValidIdBound(bound: Bound<unknown>): bound is Bound<RecordIdValue> {
	return bound instanceof BoundIncluded || bound instanceof BoundExcluded
		? isValidIdPart(bound.value)
		: true;
}

function escapeIdBound(bound: Bound<RecordIdValue>): string {
	return bound instanceof BoundIncluded || bound instanceof BoundExcluded
		? escapeIdPart(bound.value)
		: "";
}

function escapeRangeBound(bound: Bound<unknown>): string {
	if (bound === undefined) return "";
	const value = bound.value;

	if (bound instanceof Range) return `(${toSurrealqlString(value)})`;
	return toSurrealqlString(value);
}

export function rangeToCbor([beg, end]: [Bound<unknown>, Bound<unknown>]): [
	Tagged | null,
	Tagged | null,
] {
	function encodeBound(bound: Bound<unknown>): Tagged | null {
		if (bound instanceof BoundIncluded)
			return new Tagged(TAG_BOUND_INCLUDED, bound.value);
		if (bound instanceof BoundExcluded)
			return new Tagged(TAG_BOUND_EXCLUDED, bound.value);
		return null;
	}

	return [encodeBound(beg), encodeBound(end)];
}

export function cborToRange(
	range: [Tagged | null, Tagged | null],
): [Bound<unknown>, Bound<unknown>] {
	function decodeBound(bound: Tagged | null): Bound<unknown> {
		if (bound === null) return undefined;
		if (bound.tag === TAG_BOUND_INCLUDED) return new BoundIncluded(bound.value);
		if (bound.tag === TAG_BOUND_EXCLUDED) return new BoundExcluded(bound.value);
		throw new SurrealDbError("Invalid bound tag");
	}

	return [decodeBound(range[0]), decodeBound(range[1])];
}
