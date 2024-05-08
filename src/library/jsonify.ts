import { Decimal } from "./cbor/decimal.ts";
import { Geometry } from "./cbor/geometry.ts";
import { Duration } from "./cbor/index.ts";
import { RecordId, StringRecordId } from "./cbor/recordid.ts";
import { Table } from "./cbor/table.ts";
import { UUID } from "./cbor/uuid.ts";

export type Jsonify<T extends unknown> = T extends
	Date | UUID | Decimal | Duration | StringRecordId ? string
	: T extends undefined ? never
	: T extends Record<string | number | symbol, unknown> | Array<unknown>
		? { [K in keyof T]: Jsonify<T[K]> }
	: T extends Geometry ? ReturnType<T["toJSON"]>
	: T extends RecordId<infer Tb> ? `${Tb}:${string}`
	: T extends Table<infer Tb> ? `${Tb}`
	: T;

export function jsonify<T extends unknown>(input: T): Jsonify<T> {
	return JSON.parse(JSON.stringify(input));
}
