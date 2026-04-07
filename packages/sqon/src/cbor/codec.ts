import { decode, encode, type Replacer, Tagged } from "@surrealdb/cbor";
import type { CodecOptions, ValueCodec } from "../types/codec.ts";
import { BoundExcluded, BoundIncluded } from "../utils/range.ts";
import {
    DATETIME_SYMBOL,
    DECIMAL_SYMBOL,
    DURATION_SYMBOL,
    FILE_REF_SYMBOL,
    FUTURE_SYMBOL,
    GEOMETRY_COLLECTION_SYMBOL,
    GEOMETRY_LINE_SYMBOL,
    GEOMETRY_MULTI_LINE_SYMBOL,
    GEOMETRY_MULTI_POINT_SYMBOL,
    GEOMETRY_MULTI_POLYGON_SYMBOL,
    GEOMETRY_POINT_SYMBOL,
    GEOMETRY_POLYGON_SYMBOL,
    hasSymbol,
    RANGE_SYMBOL,
    RECORD_ID_RANGE_SYMBOL,
    RECORD_ID_SYMBOL,
    STRING_RECORD_ID_SYMBOL,
    TABLE_SYMBOL,
    UUID_SYMBOL,
} from "../utils/symbols.ts";
import type { DateTimeTuple } from "../value/datetime.ts";
import { FileRef } from "../value/file.ts";
import {
    DateTime,
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
    type StringRecordId,
    Table,
    Uuid,
} from "../value/index.ts";
import { cborToRange, rangeToCbor } from "./utils.ts";

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

// File Pointer
const TAG_FILE_POINTER = 55;

// Sets
const TAG_SET = 56;

// Custom Geometries
const TAG_GEOMETRY_POINT = 88;
const TAG_GEOMETRY_LINE = 89;
const TAG_GEOMETRY_POLYGON = 90;
const TAG_GEOMETRY_MULTIPOINT = 91;
const TAG_GEOMETRY_MULTILINE = 92;
const TAG_GEOMETRY_MULTIPOLYGON = 93;
const TAG_GEOMETRY_COLLECTION = 94;

/**
 * A class used to encode and decode SurrealQL values using CBOR
 */
export class CborCodec implements ValueCodec<Uint8Array> {
    static default = new CborCodec({});

    #options: CodecOptions;

    constructor(options: CodecOptions) {
        this.#options = options;
    }

    encode<T>(data: T): Uint8Array {
        return encode(data, {
            replacer: this.replacer,
            partial: false,
        });
    }

    decode<T>(data: Uint8Array): T {
        return decode(data, {
            tagged: this.tagged,
        });
    }

    protected replacer: Replacer = (input: unknown): unknown => {
        const value = this.#encodeValue(input);

        if (value instanceof Date) {
            return new Tagged(TAG_CUSTOM_DATETIME, new DateTime(value).toCompact());
        }
        if (value && hasSymbol(value, DATETIME_SYMBOL)) {
            return new Tagged(TAG_CUSTOM_DATETIME, (value as DateTime).toCompact());
        }
        if (value === undefined) return new Tagged(TAG_NONE, null);
        if (value && hasSymbol(value, UUID_SYMBOL)) {
            return new Tagged(TAG_SPEC_UUID, (value as Uuid).toBuffer());
        }
        if (value && hasSymbol(value, DECIMAL_SYMBOL)) {
            return new Tagged(TAG_STRING_DECIMAL, (value as Decimal).toString());
        }
        if (value && hasSymbol(value, DURATION_SYMBOL)) {
            return new Tagged(TAG_CUSTOM_DURATION, (value as Duration).toCompact());
        }
        if (value && hasSymbol(value, RECORD_ID_SYMBOL)) {
            return new Tagged(TAG_RECORDID, [
                (value as RecordId).table.name,
                (value as RecordId).id,
            ]);
        }
        if (value && hasSymbol(value, STRING_RECORD_ID_SYMBOL)) {
            return new Tagged(TAG_RECORDID, (value as StringRecordId).toString());
        }
        if (value && hasSymbol(value, RECORD_ID_RANGE_SYMBOL)) {
            return new Tagged(TAG_RECORDID, [
                (value as RecordIdRange).table.name,
                new Tagged(
                    TAG_RANGE,
                    rangeToCbor([(value as RecordIdRange).begin, (value as RecordIdRange).end]),
                ),
            ]);
        }
        if (value && hasSymbol(value, TABLE_SYMBOL))
            return new Tagged(TAG_TABLE, (value as Table).name);
        if (value && hasSymbol(value, FUTURE_SYMBOL))
            return new Tagged(TAG_FUTURE, (value as Future).body);
        if (value && hasSymbol(value, RANGE_SYMBOL))
            return new Tagged(
                TAG_RANGE,
                rangeToCbor([
                    (value as Range<unknown, unknown>).begin,
                    (value as Range<unknown, unknown>).end,
                ]),
            );
        if (value && hasSymbol(value, FILE_REF_SYMBOL)) {
            return new Tagged(TAG_FILE_POINTER, [
                (value as FileRef).bucket,
                (value as FileRef).key,
            ]);
        }
        if (value instanceof Set) {
            return new Tagged(TAG_SET, [...value]);
        }
        if (value && hasSymbol(value, GEOMETRY_POINT_SYMBOL)) {
            return new Tagged(TAG_GEOMETRY_POINT, (value as GeometryPoint).point);
        }
        if (value && hasSymbol(value, GEOMETRY_LINE_SYMBOL)) {
            return new Tagged(TAG_GEOMETRY_LINE, (value as GeometryLine).line);
        }
        if (value && hasSymbol(value, GEOMETRY_POLYGON_SYMBOL)) {
            return new Tagged(TAG_GEOMETRY_POLYGON, (value as GeometryPolygon).polygon);
        }
        if (value && hasSymbol(value, GEOMETRY_MULTI_POINT_SYMBOL)) {
            return new Tagged(TAG_GEOMETRY_MULTIPOINT, (value as GeometryMultiPoint).points);
        }
        if (value && hasSymbol(value, GEOMETRY_MULTI_LINE_SYMBOL)) {
            return new Tagged(TAG_GEOMETRY_MULTILINE, (value as GeometryMultiLine).lines);
        }
        if (value && hasSymbol(value, GEOMETRY_MULTI_POLYGON_SYMBOL)) {
            return new Tagged(TAG_GEOMETRY_MULTIPOLYGON, (value as GeometryMultiPolygon).polygons);
        }
        if (value && hasSymbol(value, GEOMETRY_COLLECTION_SYMBOL)) {
            return new Tagged(TAG_GEOMETRY_COLLECTION, (value as GeometryCollection).collection);
        }
        return value;
    };

    protected tagged: Record<number, Replacer> = {
        [TAG_SPEC_DATETIME]: (v) => this.#decodeValue(this.#resolveSpecDate(v)),
        [TAG_CUSTOM_DATETIME]: (v) => this.#decodeValue(this.#resolveCustomDate(v)),
        [TAG_SPEC_UUID]: (v) => this.#decodeValue(new Uuid(v)),
        [TAG_STRING_UUID]: (v) => this.#decodeValue(new Uuid(v)),
        [TAG_NONE]: (_v) => this.#decodeValue(undefined),
        [TAG_STRING_DECIMAL]: (v) => this.#decodeValue(new Decimal(v)),
        [TAG_STRING_DURATION]: (v) => this.#decodeValue(new Duration(v)),
        [TAG_CUSTOM_DURATION]: (v) => this.#decodeValue(new Duration(v)),
        [TAG_TABLE]: (v) => this.#decodeValue(new Table(v)),
        [TAG_FUTURE]: (v) => this.#decodeValue(new Future(v)),
        [TAG_RANGE]: (v) => this.#decodeValue(new Range(...cborToRange(v))),
        [TAG_BOUND_INCLUDED]: (v) => this.#decodeValue(new BoundIncluded(v)),
        [TAG_BOUND_EXCLUDED]: (v) => this.#decodeValue(new BoundExcluded(v)),
        [TAG_RECORDID]: (v) => {
            if (hasSymbol(v[1], RANGE_SYMBOL)) {
                return this.#decodeValue(new RecordIdRange(v[0], v[1].begin, v[1].end));
            }
            return this.#decodeValue(new RecordId(v[0], v[1]));
        },
        [TAG_FILE_POINTER]: (v) => this.#decodeValue(new FileRef(v[0], v[1])),
        [TAG_SET]: (v) => this.#decodeValue(new Set(v)),
        [TAG_GEOMETRY_POINT]: (v) => this.#decodeValue(new GeometryPoint(v)),
        [TAG_GEOMETRY_LINE]: (v) => this.#decodeValue(new GeometryLine(v)),
        [TAG_GEOMETRY_POLYGON]: (v) => this.#decodeValue(new GeometryPolygon(v)),
        [TAG_GEOMETRY_MULTIPOINT]: (v) => this.#decodeValue(new GeometryMultiPoint(v)),
        [TAG_GEOMETRY_MULTILINE]: (v) => this.#decodeValue(new GeometryMultiLine(v)),
        [TAG_GEOMETRY_MULTIPOLYGON]: (v) => this.#decodeValue(new GeometryMultiPolygon(v)),
        [TAG_GEOMETRY_COLLECTION]: (v) => this.#decodeValue(new GeometryCollection(v)),
    };

    #resolveSpecDate(v: string): unknown {
        return this.#options.useNativeDates ? new Date(v) : new DateTime(v);
    }

    #resolveCustomDate(v: DateTimeTuple): unknown {
        return this.#options.useNativeDates
            ? new Date(Number(v[0]) * 1000 + Number(v[1]) / 1000000)
            : new DateTime(v);
    }

    #encodeValue(v: unknown): unknown {
        return this.#options.valueEncodeVisitor ? this.#options.valueEncodeVisitor(v) : v;
    }

    #decodeValue(v: unknown): unknown {
        return this.#options.valueDecodeVisitor ? this.#options.valueDecodeVisitor(v) : v;
    }
}
