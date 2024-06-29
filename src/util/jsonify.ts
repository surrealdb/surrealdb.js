import {
	Decimal,
	Duration,
	Geometry,
	RecordId,
	StringRecordId,
	Table,
	Uuid,
} from "../data";

export type Jsonify<T> = T extends
	| Date
	| Uuid
	| Decimal
	| Duration
	| StringRecordId
	? string
	: T extends undefined
		? never
		: T extends Record<string | number | symbol, unknown> | Array<unknown>
			? { [K in keyof T]: Jsonify<T[K]> }
			: T extends Map<infer K, infer V>
				? Map<K, Jsonify<V>>
				: T extends Set<infer V>
					? Set<Jsonify<V>>
					: T extends Geometry
						? ReturnType<T["toJSON"]>
						: T extends RecordId<infer Tb>
							? `${Tb}:${string}`
							: T extends Table<infer Tb>
								? `${Tb}`
								: T;

export function jsonify<T>(input: T): Jsonify<T> {
	if (typeof input === "object") {
		if (input === null) return null as Jsonify<T>;

		// We only want to process "SurrealQL values"
		if (
			input instanceof Date ||
			input instanceof Uuid ||
			input instanceof Decimal ||
			input instanceof Duration ||
			input instanceof StringRecordId ||
			input instanceof RecordId ||
			input instanceof Geometry ||
			input instanceof Table
		) {
			return input.toJSON();
		}

		// We check by prototype, because we do not want to process derivatives of objects and arrays
		switch (Object.getPrototypeOf(input)) {
			case Object.prototype: {
				const entries = Object.entries(input as object);
				const mapped = entries
					.map(([k, v]) => [k, jsonify(v)])
					.filter(([_, v]) => v !== undefined);
				return Object.fromEntries(mapped) as Jsonify<T>;
			}
			case Map.prototype: {
				const entries = Array.from(input as [string, unknown][]);
				const mapped = entries
					.map(([k, v]) => [k, jsonify(v)])
					.filter(([_, v]) => v !== undefined);
				return new Map(mapped as [string, unknown][]) as Jsonify<T>;
			}
			case Array.prototype:
				return (input as []).map(jsonify) as Jsonify<T>;
			case Set.prototype:
				return new Set([...(input as [])].map(jsonify)) as Jsonify<T>;
		}
	}

	return input as Jsonify<T>;
}
