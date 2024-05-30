import {
	decode as decode_cbor,
	encode as encode_cbor,
	TaggedValue,
} from "cbor-redux";
import { RecordId, StringRecordId } from "./recordid.ts";
import { UUID, uuidv4, uuidv7 } from "./uuid.ts";
import {
	cborCustomDurationToDuration,
	Duration,
	durationToCborCustomDuration,
} from "./duration.ts";
import { Decimal } from "./decimal.ts";
import {
	GeometryCollection,
	GeometryLine,
	GeometryMultiLine,
	GeometryMultiPoint,
	GeometryMultiPolygon,
	GeometryPoint,
	GeometryPolygon,
} from "./geometry.ts";
import { Table } from "./table.ts";
import { cborCustomDateToDate, dateToCborCustomDate } from "./datetime.ts";

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

// Custom Geometries
const TAG_GEOMETRY_POINT = 88;
const TAG_GEOMETRY_LINE = 89;
const TAG_GEOMETRY_POLYGON = 90;
const TAG_GEOMETRY_MULTIPOINT = 91;
const TAG_GEOMETRY_MULTILINE = 92;
const TAG_GEOMETRY_MULTIPOLYGON = 93;
const TAG_GEOMETRY_COLLECTION = 94;

export function encodeCbor<T extends unknown>(data: T): ArrayBuffer {
	return encode_cbor<T>(data, (_, v) => {
		if (v instanceof Date) {
			return new TaggedValue(
				dateToCborCustomDate(v),
				TAG_CUSTOM_DATETIME,
			);
		}
		if (v === undefined) return new TaggedValue(null, TAG_NONE);
		if (v instanceof UUID) {
			return new TaggedValue(v.bytes.buffer, TAG_SPEC_UUID);
		}
		if (v instanceof Decimal) {
			return new TaggedValue(v.toString(), TAG_STRING_DECIMAL);
		}
		if (v instanceof Duration) {
			return new TaggedValue(
				durationToCborCustomDuration(v),
				TAG_CUSTOM_DURATION,
			);
		}
		if (v instanceof RecordId) {
			return new TaggedValue([v.tb, v.id], TAG_RECORDID);
		}
		if (v instanceof StringRecordId) {
			return new TaggedValue(v.rid, TAG_RECORDID);
		}
		if (v instanceof Table) return new TaggedValue(v.tb, TAG_TABLE);
		if (v instanceof GeometryPoint) {
			return new TaggedValue(v.point, TAG_GEOMETRY_POINT);
		}
		if (v instanceof GeometryLine) {
			return new TaggedValue(v.line, TAG_GEOMETRY_LINE);
		}
		if (v instanceof GeometryPolygon) {
			return new TaggedValue(v.polygon, TAG_GEOMETRY_POLYGON);
		}
		if (v instanceof GeometryMultiPoint) {
			return new TaggedValue(v.points, TAG_GEOMETRY_MULTIPOINT);
		}
		if (v instanceof GeometryMultiLine) {
			return new TaggedValue(v.lines, TAG_GEOMETRY_MULTILINE);
		}
		if (v instanceof GeometryMultiPolygon) {
			return new TaggedValue(v.polygons, TAG_GEOMETRY_MULTIPOLYGON);
		}
		if (v instanceof GeometryCollection) {
			return new TaggedValue(v.collection, TAG_GEOMETRY_COLLECTION);
		}
		return v;
	});
}

export function decodeCbor(data: ArrayBuffer): any {
	return decode_cbor(data, (_, v) => {
		if (!(v instanceof TaggedValue)) return v;

		switch (v.tag) {
			case TAG_SPEC_DATETIME:
				return new Date(v.value);
			case TAG_SPEC_UUID:
				return UUID.ofInner(new Uint8Array(v.value));
			case TAG_CUSTOM_DATETIME:
				return cborCustomDateToDate(v.value);
			case TAG_NONE:
				return undefined;
			case TAG_STRING_UUID:
				return UUID.parse(v.value);
			case TAG_STRING_DECIMAL:
				return new Decimal(v.value);
			case TAG_STRING_DURATION:
				return new Duration(v.value);
			case TAG_CUSTOM_DURATION:
				return cborCustomDurationToDuration(v.value);
			case TAG_RECORDID:
				return new RecordId(v.value[0], v.value[1]);
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
	});
}

export {
	Decimal,
	Duration,
	GeometryCollection,
	GeometryLine,
	GeometryMultiLine,
	GeometryMultiPoint,
	GeometryMultiPolygon,
	GeometryPoint,
	GeometryPolygon,
	RecordId,
	StringRecordId,
	Table,
	UUID,
	uuidv4,
	uuidv7,
};
