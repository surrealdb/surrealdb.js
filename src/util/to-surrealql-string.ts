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

export function toSurrealqlString(input: unknown): string {
	if (typeof input === "object") {
		if (input === null) return "NULL";
		if (input === undefined) return "NONE";

		// We explicitely use string prefixes to ensure compability with both SurrealDB 1.x and 2.x
		if (input instanceof Date) return `d${JSON.stringify(input.toISOString())}`;
		if (input instanceof Uuid) return `u${JSON.stringify(input.toString())}`;
		if (input instanceof RecordId || input instanceof StringRecordId)
			return `r${JSON.stringify(input.toString())}`;
		if (typeof input === "string") return `s${JSON.stringify(input)}`;

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
				for (const [k, v] of Object.entries(input as object)) {
					output += `${JSON.stringify(k)}: ${toSurrealqlString(v)},`;
				}
				output += " }";
				return output;
			}
			case Map.prototype: {
				let output = "{ ";
				for (const [k, v] of (input as Map<unknown, unknown>).entries()) {
					output += `${JSON.stringify(k)}: ${toSurrealqlString(v)},`;
				}
				output += " }";
				return output;
			}
			case Array.prototype: {
				let output = "[ ";
				for (const v of input as unknown[]) {
					output += `${toSurrealqlString(v)},`;
				}
				output += " ]";
				return output;
			}
			case Set.prototype: {
				const set = new Set([...(input as [])].map(toSurrealqlString));
				return `[ ${[...set].join(", ")} ]`;
			}
		}
	}

	return `${input}`;
}
