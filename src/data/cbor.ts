import { Tagged, decode, encode } from "../cbor";
import {
	cborCustomDateToDate,
	dateToCborCustomDate,
} from "./types/datetime.ts";
import { Decimal } from "./types/decimal.ts";
import { Duration } from "./types/duration.ts";
import { Future } from "./types/future.ts";
import {
	GeometryCollection,
	GeometryLine,
	GeometryMultiLine,
	GeometryMultiPoint,
	GeometryMultiPolygon,
	GeometryPoint,
	GeometryPolygon,
} from "./types/geometry.ts";
import {
	cborToRange,
	Range,
	rangeToCbor,
	RecordIdRange,
} from "./types/range.ts";
import { RecordId, StringRecordId } from "./types/recordid.ts";
import { Table } from "./types/table.ts";
import { Uuid } from "./types/uuid.ts";

// Tags from the spec - https://www.iana.org/assignments/cbor-tags/cbor-tags.xhtml
const TAG_SPEC_DATETIME = 0;
const TAG_SPEC_UUID = 37;

// Custom tags
const TAG_NONE = 6;
const TAG_TABLE = 7;
const TAG_RECORDID = 8;
const TAG_STRING_UUID = 9;
const TAG_STRING_DECIMAL = 10;
// const TAG_BINARY_DECIMAL = 11;
const TAG_CUSTOM_DATETIME = 12;
const TAG_STRING_DURATION = 13;
const TAG_CUSTOM_DURATION = 14;
const TAG_FUTURE = 15;

// Ranges
export const TAG_RANGE = 49;
export const TAG_BOUND_INCLUDED = 50;
export const TAG_BOUND_EXCLUDED = 51;

// Custom Geometries
const TAG_GEOMETRY_POINT = 88;
const TAG_GEOMETRY_LINE = 89;
const TAG_GEOMETRY_POLYGON = 90;
const TAG_GEOMETRY_MULTIPOINT = 91;
const TAG_GEOMETRY_MULTILINE = 92;
const TAG_GEOMETRY_MULTIPOLYGON = 93;
const TAG_GEOMETRY_COLLECTION = 94;

export const replacer = {
	encode(v: unknown): unknown {
		if (v instanceof Date) {
			return new Tagged(TAG_CUSTOM_DATETIME, dateToCborCustomDate(v));
		}
		if (v === undefined) return new Tagged(TAG_NONE, null);
		if (v instanceof Uuid) {
			return new Tagged(TAG_SPEC_UUID, v.toBuffer());
		}
		if (v instanceof Decimal) {
			return new Tagged(TAG_STRING_DECIMAL, v.toString());
		}
		if (v instanceof Duration) {
			return new Tagged(TAG_CUSTOM_DURATION, v.toCompact());
		}
		if (v instanceof RecordId) {
			return new Tagged(TAG_RECORDID, [v.tb, v.id]);
		}
		if (v instanceof StringRecordId) {
			return new Tagged(TAG_RECORDID, v.rid);
		}
		if (v instanceof RecordIdRange) {
			return new Tagged(TAG_RECORDID, [
				v.tb,
				new Tagged(TAG_RANGE, rangeToCbor([v.beg, v.end])),
			]);
		}
		if (v instanceof Table) return new Tagged(TAG_TABLE, v.tb);
		if (v instanceof Future) return new Tagged(TAG_FUTURE, v.inner);
		if (v instanceof Range)
			return new Tagged(TAG_RANGE, rangeToCbor([v.beg, v.end]));
		if (v instanceof GeometryPoint) {
			return new Tagged(TAG_GEOMETRY_POINT, v.point);
		}
		if (v instanceof GeometryLine) {
			return new Tagged(TAG_GEOMETRY_LINE, v.line);
		}
		if (v instanceof GeometryPolygon) {
			return new Tagged(TAG_GEOMETRY_POLYGON, v.polygon);
		}
		if (v instanceof GeometryMultiPoint) {
			return new Tagged(TAG_GEOMETRY_MULTIPOINT, v.points);
		}
		if (v instanceof GeometryMultiLine) {
			return new Tagged(TAG_GEOMETRY_MULTILINE, v.lines);
		}
		if (v instanceof GeometryMultiPolygon) {
			return new Tagged(TAG_GEOMETRY_MULTIPOLYGON, v.polygons);
		}
		if (v instanceof GeometryCollection) {
			return new Tagged(TAG_GEOMETRY_COLLECTION, v.collection);
		}
		return v;
	},
	decode(v: unknown): unknown {
		if (!(v instanceof Tagged)) return v;

		switch (v.tag) {
			case TAG_SPEC_DATETIME:
				return new Date(v.value);
			case TAG_SPEC_UUID:
			case TAG_STRING_UUID:
				return new Uuid(v.value);
			case TAG_CUSTOM_DATETIME:
				return cborCustomDateToDate(v.value);
			case TAG_NONE:
				return undefined;
			case TAG_STRING_DECIMAL:
				return new Decimal(v.value);
			case TAG_STRING_DURATION:
				return new Duration(v.value);
			case TAG_CUSTOM_DURATION:
				return Duration.fromCompact(v.value);
			case TAG_TABLE:
				return new Table(v.value);
			case TAG_FUTURE:
				return new Future(v.value);
			case TAG_RANGE:
				return new Range(...cborToRange(v.value));
			case TAG_RECORDID: {
				if (v.value[1] instanceof Range) {
					return new RecordIdRange(v.value[0], v.value[1].beg, v.value[1].end);
				}
				return new RecordId(v.value[0], v.value[1]);
			}
			case TAG_GEOMETRY_POINT:
				return new GeometryPoint(v.value);
			case TAG_GEOMETRY_LINE:
				return new GeometryLine(v.value);
			case TAG_GEOMETRY_POLYGON:
				return new GeometryPolygon(v.value);
			case TAG_GEOMETRY_MULTIPOINT:
				return new GeometryMultiPoint(v.value);
			case TAG_GEOMETRY_MULTILINE:
				return new GeometryMultiLine(v.value);
			case TAG_GEOMETRY_MULTIPOLYGON:
				return new GeometryMultiPolygon(v.value);
			case TAG_GEOMETRY_COLLECTION:
				return new GeometryCollection(v.value);
		}
	},
};

Object.freeze(replacer);

export function encodeCbor<T>(data: T): ArrayBuffer {
	return encode(data, {
		replacer: replacer.encode,
	});
}

// biome-ignore lint/suspicious/noExplicitAny: Don't know what it will return
export function decodeCbor(data: ArrayBufferLike): any {
	return decode(data, {
		replacer: replacer.decode,
	});
}
