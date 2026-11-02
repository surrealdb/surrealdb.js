import { decode, Encoded, encode, POW_2_53, type Replacer, Tagged } from "@surrealdb/cbor";
import { InvalidNumberError, ShapedFrameError, UnsupportedValueError } from "../../errors.ts";
import { NANOS_PER_SECOND, SECONDS_PER_DAY } from "../../internal/calendar.ts";
import type { CodecOptions, ValueCodec } from "../../types/codec.ts";
import { BoundExcluded, BoundIncluded } from "../../utils/range.ts";
import {
    BIG_DECIMAL_SYMBOL,
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
    INTERVAL_SYMBOL,
    PLAIN_DATE_SYMBOL,
    PLAIN_TIME_SYMBOL,
    RANGE_SYMBOL,
    RECORD_ID_RANGE_SYMBOL,
    RECORD_ID_SYMBOL,
    REGEX_SYMBOL,
    SIZED_NUMBER_SYMBOL,
    STRING_RECORD_ID_SYMBOL,
    TABLE_SYMBOL,
    TIMESTAMP_SYMBOL,
    UUID_SYMBOL,
} from "../../utils/symbols.ts";
import type { DateTimeTuple } from "../../value/datetime.ts";
import { FileRef } from "../../value/file.ts";
import {
    BigDecimal,
    DateTime,
    Decimal,
    Duration,
    F16,
    F32,
    Future,
    GeometryCollection,
    GeometryLine,
    GeometryMultiLine,
    GeometryMultiPoint,
    GeometryMultiPolygon,
    GeometryPoint,
    GeometryPolygon,
    I8,
    I16,
    I32,
    Interval,
    PlainDate,
    PlainTime,
    Range,
    RecordId,
    RecordIdRange,
    type RecordIdValue,
    Regex,
    SizedNumber,
    type SizedNumberKind,
    StringRecordId,
    Table,
    Timestamp,
    U8,
    U16,
    U32,
    U64,
    Uuid,
} from "../../value/index.ts";
import { f16Bits, f16round } from "../../value/sized.ts";
import { StrictReader } from "./reader.ts";
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

// Shaped blocks, which only the `shaped` format carries
const TAG_SHAPED_BLOCK = 57;

// Custom Geometries
const TAG_GEOMETRY_POINT = 88;
const TAG_GEOMETRY_LINE = 89;
const TAG_GEOMETRY_POLYGON = 90;
const TAG_GEOMETRY_MULTIPOINT = 91;
const TAG_GEOMETRY_MULTILINE = 92;
const TAG_GEOMETRY_MULTIPOLYGON = 93;
const TAG_GEOMETRY_COLLECTION = 94;

// Sized numbers (cbor.2 only)
// The 4.0 types SurrealQL shares with PostgreSQL and MySQL (cbor.2 only)
const TAG_DATE = 100;
const TAG_TIME = 189;
const TAG_TIMESTAMP = 190;
const TAG_INTERVAL = 191;
const TAG_BIGDECIMAL = 192;
const TAG_REGEX = 193;

const TAG_SIZED: Record<SizedNumberKind, number> = {
    i8: 180,
    u8: 181,
    i16: 182,
    u16: 183,
    i32: 184,
    u32: 185,
    u64: 186,
    f16: 187,
    f32: 188,
};

const SIZED_CLASSES: Record<SizedNumberKind, new (value: never) => SizedNumber> = {
    i8: I8,
    u8: U8,
    i16: I16,
    u16: U16,
    i32: I32,
    u32: U32,
    u64: U64,
    f16: F16,
    f32: F32,
};

const I64_MIN = -(2n ** 63n);
const I64_MAX = 2n ** 63n - 1n;

/**
 * Options for the CBOR codec
 */
export interface CborCodecOptions extends CodecOptions {
    /**
     * The CBOR dialect: 1 for `cbor`, which every server speaks, or 2 for `cbor.2`, which
     * SurrealDB 4.0 adds. `cbor.2` is `cbor` plus the tags 180 to 188 of the sized numbers and
     * the tags 100 and 189 to 193 of the date, time, timestamp, interval, bigdecimal and regex.
     * Defaults to 1.
     */
    version?: 1 | 2;
}

/**
 * An integer which may be past the signed 64-bit range, where the protocol allows a u64. It is
 * written directly, as the codec refuses such an integer anywhere else.
 */
function uint64<T>(value: T): T | Encoded {
    if (typeof value !== "bigint" || value <= I64_MAX) return value;

    const buf = new Uint8Array(9);
    buf[0] = 0x1b;
    new DataView(buf.buffer).setBigUint64(1, value, false);
    return new Encoded(buf);
}

/**
 * A float in the narrowest IEEE 754 width which holds it exactly, as the server writes them.
 */
function encodeFloat(value: number): Encoded {
    if (Number.isNaN(value) || Object.is(f16round(value), value)) {
        const bits = f16Bits(value);
        return new Encoded(new Uint8Array([0xf9, bits >> 8, bits & 0xff]));
    }

    const width = Math.fround(value) === value ? 4 : 8;
    const buf = new Uint8Array(width + 1);
    const view = new DataView(buf.buffer);

    if (width === 4) {
        buf[0] = 0xfa;
        view.setFloat32(1, value, false);
    } else {
        buf[0] = 0xfb;
        view.setFloat64(1, value, false);
    }

    return new Encoded(buf);
}

/**
 * A codec for encoding and decoding SurrealQL values using the SQON Binary (cbor) format.
 */
export class CborCodec implements ValueCodec<Uint8Array> {
    /**
     * The default CborCodec instance.
     */
    static readonly DEFAULT: CborCodec = new CborCodec({});

    #options: CborCodecOptions;
    #reader: StrictReader | undefined;

    constructor(options: CborCodecOptions) {
        this.#options = options;
    }

    /**
     * The CBOR dialect this codec speaks: 1 for `cbor`, 2 for `cbor.2`
     */
    get version(): 1 | 2 {
        return this.#options.version ?? 1;
    }

    encode<T>(data: T): Uint8Array {
        return encode(data, {
            replacer: this.replacer,
            partial: false,
        });
    }

    decode<T>(data: Uint8Array): T {
        const reader = new StrictReader(data);
        const outer = this.#reader;
        this.#reader = reader;

        try {
            return decode(reader, {
                tagged: this.tagged,
            });
        } finally {
            this.#reader = outer;
        }
    }

    protected replacer: Replacer = (input: unknown): unknown => {
        const value = this.#encodeValue(input);

        if (typeof value === "bigint" && (value < I64_MIN || value > I64_MAX)) {
            throw new InvalidNumberError(
                `The integer ${value} is outside the signed 64-bit range of a SurrealDB int: send it as a Decimal, or as a U64 when it fits one`,
            );
        }

        if (value && hasSymbol(value, SIZED_NUMBER_SYMBOL)) {
            return this.#encodeSized(value as SizedNumber);
        }

        // An integer to JavaScript, but a float to SurrealDB
        if (Object.is(value, -0)) return encodeFloat(-0);

        if (
            typeof value === "number" &&
            Number.isInteger(value) &&
            (value > POW_2_53 || value < -POW_2_53)
        ) {
            const buf = new Uint8Array(9);
            buf[0] = 251; // float64 (0xfb)
            new DataView(buf.buffer, buf.byteOffset, 9).setFloat64(1, value, false);
            return new Encoded(buf);
        }

        if (value && hasSymbol(value, PLAIN_DATE_SYMBOL))
            return this.#encodeDate(value as PlainDate);
        if (value && hasSymbol(value, PLAIN_TIME_SYMBOL))
            return this.#encodeTime(value as PlainTime);
        if (value && hasSymbol(value, TIMESTAMP_SYMBOL)) {
            return this.#encodeTimestamp(value as Timestamp);
        }
        if (value && hasSymbol(value, INTERVAL_SYMBOL)) {
            return this.#encodeInterval(value as Interval);
        }
        if (value && hasSymbol(value, BIG_DECIMAL_SYMBOL)) {
            return this.#encodeBigDecimal(value as BigDecimal);
        }
        if (value && hasSymbol(value, REGEX_SYMBOL)) return this.#encodeRegex(value as Regex);

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
            // Its seconds are a u64
            return new Tagged(TAG_CUSTOM_DURATION, (value as Duration).toCompact().map(uint64));
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
        // Futures left SurrealDB in 3.0, and 4.0, the only server to speak cbor.2, refuses tag 15
        if (value && hasSymbol(value, FUTURE_SYMBOL)) {
            if (this.version === 2) {
                throw new UnsupportedValueError("SurrealDB 4.0 has no futures to send one to");
            }
            return new Tagged(TAG_FUTURE, (value as Future).body);
        }
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
            if (typeof v === "string") {
                return this.#decodeValue(new StringRecordId(v));
            }
            if (hasSymbol(v[1], RANGE_SYMBOL)) {
                return this.#decodeValue(new RecordIdRange(v[0], v[1].begin, v[1].end));
            }
            return this.#decodeValue(new RecordId(v[0], this.#recordIdKey(v[1])));
        },
        [TAG_FILE_POINTER]: (v) => this.#decodeValue(new FileRef(v[0], v[1])),
        [TAG_SET]: (v) => this.#decodeValue(new Set(v)),
        // A block is only ever written on the `shaped` format, whose codec reads this tag; on
        // every other format it is refused rather than passed through as an opaque tag, which
        // would drop a statement's rows silently.
        [TAG_SHAPED_BLOCK]: () => {
            throw new ShapedFrameError("a shaped block outside the shaped format");
        },
        [TAG_GEOMETRY_POINT]: (v) => this.#decodeValue(new GeometryPoint(v)),
        [TAG_GEOMETRY_LINE]: (v) => this.#decodeValue(new GeometryLine(v)),
        [TAG_GEOMETRY_POLYGON]: (v) => this.#decodeValue(new GeometryPolygon(v)),
        [TAG_GEOMETRY_MULTIPOINT]: (v) => this.#decodeValue(new GeometryMultiPoint(v)),
        [TAG_GEOMETRY_MULTILINE]: (v) => this.#decodeValue(new GeometryMultiLine(v)),
        [TAG_GEOMETRY_MULTIPOLYGON]: (v) => this.#decodeValue(new GeometryMultiPolygon(v)),
        [TAG_GEOMETRY_COLLECTION]: (v) => this.#decodeValue(new GeometryCollection(v)),
        [TAG_DATE]: (v) => this.#decodeValue(new PlainDate(Number(this.#v2Integer(TAG_DATE, v)))),
        [TAG_TIME]: (v) => this.#decodeValue(new PlainTime(this.#v2Integer(TAG_TIME, v))),
        [TAG_TIMESTAMP]: (v) => {
            const [seconds, nanos] = this.#v2Tuple(TAG_TIMESTAMP, v, 2);
            return this.#decodeValue(new Timestamp([seconds as bigint, nanos as bigint]));
        },
        [TAG_INTERVAL]: (v) => {
            const [months, days, micros] = this.#v2Tuple(TAG_INTERVAL, v, 3);
            return this.#decodeValue(new Interval([Number(months), Number(days), micros]));
        },
        [TAG_BIGDECIMAL]: (v) => this.#decodeValue(new BigDecimal(this.#v2Text(TAG_BIGDECIMAL, v))),
        [TAG_REGEX]: (v) => this.#decodeValue(new Regex(this.#v2Text(TAG_REGEX, v))),
        ...Object.fromEntries(
            Object.entries(TAG_SIZED).map(([kind, tag]) => [
                tag,
                (v: unknown) => this.#decodeValue(this.#decodeSized(kind as SizedNumberKind, v)),
            ]),
        ),
    };

    #encodeSized(value: SizedNumber): unknown {
        const float = value.kind === "f16" || value.kind === "f32";

        if (this.version === 2) {
            const tag = TAG_SIZED[value.kind];
            if (float) return new Tagged(tag, encodeFloat(value.value as number));

            return new Tagged(tag, uint64(value.value));
        }

        // Plain cbor has no sized numbers: widen them, as the server does
        if (float) return encodeFloat(value.value as number);
        if (typeof value.value === "bigint") {
            if (value.value > I64_MAX)
                return new Tagged(TAG_STRING_DECIMAL, value.value.toString());
            return value.value <= POW_2_53 ? Number(value.value) : value.value;
        }
        return value.value;
    }

    // Plain cbor has none of the 4.0 types below: each is widened as the server widens it

    #encodeDate(value: PlainDate): unknown {
        if (this.version === 2) return new Tagged(TAG_DATE, value.days);
        return new Tagged(TAG_CUSTOM_DATETIME, [value.days * SECONDS_PER_DAY, 0]);
    }

    #encodeTime(value: PlainTime): unknown {
        if (this.version === 2) return new Tagged(TAG_TIME, value.nanos);
        const secs = Math.floor(value.nanos / NANOS_PER_SECOND);
        const nanos = value.nanos % NANOS_PER_SECOND;
        return new Tagged(TAG_CUSTOM_DURATION, nanos ? [secs, nanos] : secs ? [secs] : []);
    }

    #encodeTimestamp(value: Timestamp): unknown {
        return new Tagged(
            this.version === 2 ? TAG_TIMESTAMP : TAG_CUSTOM_DATETIME,
            value.toCompact(),
        );
    }

    #encodeInterval(value: Interval): unknown {
        if (this.version === 2) return new Tagged(TAG_INTERVAL, value.toCompact());
        return value.toString();
    }

    #encodeBigDecimal(value: BigDecimal): unknown {
        if (this.version === 2) return new Tagged(TAG_BIGDECIMAL, value.toString());
        // Plain cbor has no bigdecimal: a decimal when it fits one, as the server writes it, and
        // otherwise text
        if (value.fitsDecimal()) return new Tagged(TAG_STRING_DECIMAL, value.toString());
        return value.toString();
    }

    #encodeRegex(value: Regex): unknown {
        if (this.version === 2) return new Tagged(TAG_REGEX, value.pattern);
        throw new UnsupportedValueError("A regex can only be sent over cbor.2");
    }

    /** The content of a cbor.2-only tag, which must be an integer */
    #v2Integer(tag: number, value: unknown): number | bigint {
        this.#requireV2(tag);
        if (!this.#reader?.isInteger || (typeof value !== "number" && typeof value !== "bigint")) {
            throw new InvalidNumberError(`CBOR tag ${tag} must hold an integer`);
        }
        return value;
    }

    /** The content of a cbor.2-only tag, which must be an array of `length` integers */
    #v2Tuple(tag: number, value: unknown, length: number): (number | bigint)[] {
        this.#requireV2(tag);
        if (
            !Array.isArray(value) ||
            value.length !== length ||
            !value.every((v) => typeof v === "number" || typeof v === "bigint")
        ) {
            throw new InvalidNumberError(
                `CBOR tag ${tag} must hold an array of ${length} integers`,
            );
        }
        return value;
    }

    /** The content of a cbor.2-only tag, which must be text */
    #v2Text(tag: number, value: unknown): string {
        this.#requireV2(tag);
        if (typeof value !== "string") {
            throw new UnsupportedValueError(`CBOR tag ${tag} must hold text`);
        }
        return value;
    }

    #requireV2(tag: number): void {
        if (this.version !== 2) {
            throw new UnsupportedValueError(`CBOR tag ${tag} is only valid in cbor.2`);
        }
    }

    #decodeSized(kind: SizedNumberKind, value: unknown): SizedNumber {
        if (this.version !== 2) {
            throw new InvalidNumberError(
                `CBOR tag ${TAG_SIZED[kind]} (${kind}) is only valid in cbor.2`,
            );
        }

        const float = kind === "f16" || kind === "f32";
        const reader = this.#reader;
        const shaped = float ? reader?.isFloat : reader?.isInteger;

        if (!shaped || (typeof value !== "number" && typeof value !== "bigint")) {
            throw new InvalidNumberError(
                `CBOR tag ${TAG_SIZED[kind]} (${kind}) must hold ${float ? "a float" : "an integer"}`,
            );
        }

        const sized = new SIZED_CLASSES[kind](value as never);

        // A float must fit its kind exactly: the constructor rounds, the wire may not
        if (float && !Object.is(sized.value, value) && !Number.isNaN(value)) {
            throw new InvalidNumberError(`The float ${value} cannot be held exactly by ${kind}`);
        }

        return sized;
    }

    /**
     * A record id key holds an i64, so a sized integer key is read as a plain integer.
     */
    #recordIdKey(key: RecordIdValue): RecordIdValue {
        if (!(key instanceof SizedNumber)) return key;

        if (key.kind === "f16" || key.kind === "f32") {
            throw new InvalidNumberError(`A record id key cannot be a ${key.kind}`);
        }

        if (typeof key.value === "bigint") {
            if (key.value > I64_MAX) {
                throw new InvalidNumberError(
                    `The record id key ${key.value} is outside the signed 64-bit range`,
                );
            }
            return key.value <= POW_2_53 ? Number(key.value) : key.value;
        }

        return key.value;
    }

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
