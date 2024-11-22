import {
	Decimal,
	Duration,
	Future,
	Geometry,
	Range,
	RecordId,
	StringRecordId,
	Table,
	Uuid,
} from "../data";

/**
 * Recursively print any supported SurrealQL value into a string representation.
 * @param input - The input value
 * @returns Stringified SurrealQL representation
 */
export function toSurrealqlString(input: unknown): string {
	if (typeof input === "string") return `s${JSON.stringify(input)}`;
	if (input === null) return "NULL";
	if (input === undefined) return "NONE";

	if (typeof input === "object") {
		// We explicitely use string prefixes to ensure compability with both SurrealDB 1.x and 2.x
		if (input instanceof Date) return `d${JSON.stringify(input.toISOString())}`;
		if (input instanceof Uuid) return `u${JSON.stringify(input.toString())}`;
		if (input instanceof RecordId || input instanceof StringRecordId)
			return `r${JSON.stringify(input.toString())}`;

		if (input instanceof Geometry) return toSurrealqlString(input.toJSON());

		if (
			input instanceof Decimal ||
			input instanceof Duration ||
			input instanceof Future ||
			input instanceof Range ||
			input instanceof Table
		) {
			return input.toJSON();
		}

		// We check by prototype, because we do not want to process derivatives of objects and arrays
		switch (Object.getPrototypeOf(input)) {
			case Object.prototype: {
				let output = "{ ";
				const entries = Object.entries(input as object);
				for (const [i, [k, v]] of entries.entries()) {
					output += `${JSON.stringify(k)}: ${toSurrealqlString(v)}`;
					if (i < entries.length - 1) output += ", ";
				}
				output += " }";
				return output;
			}
			case Map.prototype: {
				let output = "{ ";
				const entries = Array.from((input as Map<unknown, unknown>).entries());
				for (const [i, [k, v]] of entries.entries()) {
					output += `${JSON.stringify(k)}: ${toSurrealqlString(v)}`;
					if (i < entries.length - 1) output += ", ";
				}
				output += " }";
				return output;
			}
			case Array.prototype: {
				const array = (input as unknown[]).map(toSurrealqlString);
				return `[ ${array.join(", ")} ]`;
			}
			case Set.prototype: {
				const set = new Set([...(input as [])].map(toSurrealqlString));
				return `[ ${[...set].join(", ")} ]`;
			}
		}
	}

	return `${input}`;
}
