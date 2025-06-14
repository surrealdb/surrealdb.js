import { type Replacer, Tagged, decode, encode } from "@surrealdb/cbor";
import { BoundExcluded, BoundIncluded } from "../utils/range";
import {
	Decimal,
	Duration,
	Future,
	GeometryCollection,
	GeometryLine,
	GeometryMultiLine,
	GeometryMultiPoint,
	GeometryMultiPolygon,
	GeometryPoint,
	GeometryPolygon,
	Range,
	RecordId,
	RecordIdRange,
	StringRecordId,
	Table,
	Uuid,
} from "../value";
import {
	cborCustomDateToDate,
	cborToRange,
	dateToCborCustomDate,
	rangeToCbor,
} from "./utils";

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

/**
 * The cbor replacer for SurrealDB values
 */
export const REPLACER = {
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
			return new Tagged(TAG_RECORDID, [v.table.name, v.id]);
		}
		if (v instanceof StringRecordId) {
			return new Tagged(TAG_RECORDID, v.rid);
		}
		if (v instanceof RecordIdRange) {
			return new Tagged(TAG_RECORDID, [
				v.table.name,
				new Tagged(TAG_RANGE, rangeToCbor([v.beg, v.end])),
			]);
		}
		if (v instanceof Table) return new Tagged(TAG_TABLE, v.name);
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
	decode: {
		[TAG_SPEC_DATETIME]: (v) => new Date(v),
		[TAG_SPEC_UUID]: (v) => new Uuid(v),
		[TAG_STRING_UUID]: (v) => new Uuid(v),
		[TAG_CUSTOM_DATETIME]: cborCustomDateToDate,
		[TAG_NONE]: (v) => undefined,
		[TAG_STRING_DECIMAL]: (v) => new Decimal(v),
		[TAG_STRING_DURATION]: (v) => new Duration(v),
		[TAG_CUSTOM_DURATION]: (v) => Duration.fromCompact(v),
		[TAG_TABLE]: (v) => new Table(v),
		[TAG_FUTURE]: (v) => new Future(v),
		[TAG_RANGE]: (v) => new Range(...cborToRange(v)),
		[TAG_BOUND_INCLUDED]: (v) => new BoundIncluded(v),
		[TAG_BOUND_EXCLUDED]: (v) => new BoundExcluded(v),
		[TAG_RECORDID]: (v) => {
			if (v[1] instanceof Range) {
				return new RecordIdRange(v[0], v[1].beg, v[1].end);
			}
			return new RecordId(v[0], v[1]);
		},
		[TAG_GEOMETRY_POINT]: (v) => new GeometryPoint(v),
		[TAG_GEOMETRY_LINE]: (v) => new GeometryLine(v),
		[TAG_GEOMETRY_POLYGON]: (v) => new GeometryPolygon(v),
		[TAG_GEOMETRY_MULTIPOINT]: (v) => new GeometryMultiPoint(v),
		[TAG_GEOMETRY_MULTILINE]: (v) => new GeometryMultiLine(v),
		[TAG_GEOMETRY_MULTIPOLYGON]: (v) => new GeometryMultiPolygon(v),
		[TAG_GEOMETRY_COLLECTION]: (v) => new GeometryCollection(v),
	} satisfies Record<number, Replacer>,
};

Object.freeze(REPLACER);

/**
 * Recursively encode any supported SurrealQL value into a binary CBOR representation
 *
 * @param data - The input value
 * @returns CBOR binary representation
 */
export function encodeCbor<T>(data: T): Uint8Array {
	return encode(data, {
		replacer: REPLACER.encode,
		partial: false,
	});
}

/**
 * Decode a CBOR encoded SurrealQL value into object representation
 *
 * @param data - The encoded SurrealQL value
 * @returns The parsed SurrealQL value
 */
export function decodeCbor<T>(data: Uint8Array): T {
	return decode(data, {
		tagged: REPLACER.decode,
	});
}
