import { fromBase64Url, toBase64Url } from "../../internal/base64.ts";
import type { CodecOptions, ValueCodec } from "../../types/codec.ts";
import { BoundExcluded, BoundIncluded } from "../../utils/range.ts";
import {
    DateTime,
    Decimal,
    Duration,
    F16,
    F32,
    FileRef,
    Future,
    Geometry,
    I8,
    I16,
    I32,
    Range,
    RecordId,
    RecordIdRange,
    type RecordIdValue,
    SizedNumber,
    StringRecordId,
    Table,
    U8,
    U16,
    U32,
    U64,
    Uuid,
} from "../../value/index.ts";
import type { SizedNumberKind } from "../../value/sized.ts";
import {
    createBoundExcluded,
    createBoundIncluded,
    createBytes,
    createDatetime,
    createDecimal,
    createDuration,
    createFile,
    createFuture,
    createGeometry,
    createNone,
    createObject,
    createRange,
    createRecordId,
    createSet,
    createSized,
    createStringRecordId,
    createTable,
    createUuid,
    isBoundExcluded,
    isBoundIncluded,
    isBytes,
    isDatetime,
    isDecimal,
    isDuration,
    isFile,
    isFuture,
    isGeometry,
    isNone,
    isObject,
    isRange,
    isRecordId,
    isSet,
    isStringRecordId,
    isTable,
    isUuid,
    sizedKind,
} from "./values.ts";

// A function rather than a map, as the sized number classes import this module
const sizedClass = (kind: SizedNumberKind): (new (value: never) => SizedNumber) =>
    ({ i8: I8, u8: U8, i16: I16, u16: U16, i32: I32, u32: U32, u64: U64, f16: F16, f32: F32 })[
        kind
    ];

/**
 * A codec for encoding and decoding SurrealQL values using the SQON Json format.
 */
export class JsonCodec implements ValueCodec<unknown> {
    /**
     * The default JsonCodec instance.
     */
    static readonly DEFAULT: JsonCodec = new JsonCodec({});

    #options: CodecOptions;

    constructor(options: CodecOptions) {
        this.#options = options;
    }

    /**
     * Encode a value tree to a SQON-J structure (JSON-safe plain object tree).
     */
    encode<T>(data: T): unknown {
        return this.#serialize(data);
    }

    /**
     * Decode a SQON-J structure back to value instances.
     */
    decode<T>(data: unknown): T {
        return this.#deserialize(data) as T;
    }

    #serialize(input: unknown): unknown {
        const value = this.#encodeValue(input);
        const wasEncoded = value !== input;

        if (this.#isEncodePrimitive(value)) {
            return value;
        }
        if (value === undefined) {
            return createNone();
        }
        if (value instanceof Date) {
            return createDatetime(value.toISOString());
        }
        if (value instanceof DateTime) {
            return createDatetime(value.toISOString());
        }
        if (value instanceof Decimal) {
            return createDecimal(value.toString());
        }
        if (value instanceof Duration) {
            return createDuration(value.toString());
        }
        if (value instanceof Uuid) {
            return createUuid(value.toString());
        }
        if (value instanceof RecordId) {
            return createRecordId(value.table.name, this.#serialize(value.id));
        }
        if (value instanceof StringRecordId) {
            return createStringRecordId(value.toString());
        }
        if (value instanceof RecordIdRange) {
            return createRecordId(
                value.table.name,
                createRange(this.#encodeBound(value.begin), this.#encodeBound(value.end)),
            );
        }
        if (value instanceof Table) {
            return createTable(value.name);
        }
        if (value instanceof Range) {
            return createRange(this.#encodeBound(value.begin), this.#encodeBound(value.end));
        }
        if (value instanceof FileRef) {
            return createFile(value.bucket, value.key);
        }
        if (value instanceof Future) {
            return createFuture(value.body);
        }
        if (value instanceof Uint8Array) {
            return createBytes(toBase64Url(value));
        }
        if (value instanceof Geometry) {
            return createGeometry(value.toJSON());
        }
        if (value instanceof SizedNumber) {
            return createSized(value.kind, this.#encodeSized(value.value));
        }
        if (value instanceof Set) {
            return createSet([...value].map((v) => this.#serialize(v)));
        }

        switch (Object.getPrototypeOf(value)) {
            case Array.prototype:
                return (value as unknown[]).map((v) => this.#serialize(v));
            case Map.prototype: {
                return Object.fromEntries(
                    Array.from((value as Map<string, unknown>).entries())
                        .map(([k, v]) => [k, this.#serialize(v)])
                        .filter(([, encoded]) => encoded !== undefined),
                );
            }
            case Object.prototype: {
                const obj = value as Record<string, unknown>;
                const result: Record<string, unknown> = {};
                let escaped = false;

                for (const key in obj) {
                    const encoded = this.#serialize(obj[key]);

                    if (encoded !== undefined) {
                        result[key] = encoded;
                        if (!wasEncoded && key[0] === "$") escaped = true;
                    }
                }

                return escaped ? createObject(result) : result;
            }
        }

        return value;
    }

    /** A number within ±2^53 as itself, and anything JSON cannot hold as a string */
    #encodeSized(value: number | bigint): number | string {
        if (typeof value === "bigint") {
            return value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : value.toString();
        }
        if (Object.is(value, -0)) {
            return "-0";
        }
        return Number.isFinite(value) ? value : String(value);
    }

    #encodeBound(bound: unknown): unknown {
        if (bound instanceof BoundIncluded) {
            return createBoundIncluded(this.#serialize(bound.value));
        }
        if (bound instanceof BoundExcluded) {
            return createBoundExcluded(this.#serialize(bound.value));
        }

        return null;
    }

    #isEncodePrimitive(value: unknown): boolean {
        return (
            value === null ||
            typeof value === "boolean" ||
            typeof value === "string" ||
            typeof value === "number" ||
            typeof value === "bigint"
        );
    }

    #deserialize(input: unknown): unknown {
        if (this.#isDecodePrimitive(input)) {
            return this.#decodeValue(input);
        }

        if (Array.isArray(input)) {
            return this.#decodeValue(input.map((v) => this.#deserialize(v)));
        }

        const obj = input as Record<string, unknown>;

        if (isObject(obj)) {
            return Object.fromEntries(
                Object.entries(obj.$object)
                    .map(([k, v]) => [k, this.#deserialize(v)])
                    .filter(([, decoded]) => decoded !== undefined),
            );
        }
        if (isNone(obj)) {
            return this.#decodeValue(undefined);
        }
        if (isDatetime(obj)) {
            return this.#decodeValue(this.#resolveSpecDate(obj.$datetime));
        }
        if (isDecimal(obj)) {
            return this.#decodeValue(new Decimal(obj.$decimal));
        }
        if (isDuration(obj)) {
            return this.#decodeValue(new Duration(obj.$duration));
        }
        if (isUuid(obj)) {
            return this.#decodeValue(new Uuid(obj.$uuid));
        }
        if (isRecordId(obj)) {
            const id = this.#deserialize(obj.$recordId.id);
            if (id instanceof Range) {
                return this.#decodeValue(new RecordIdRange(obj.$recordId.tb, id.begin, id.end));
            }
            return this.#decodeValue(new RecordId(obj.$recordId.tb, id as RecordIdValue));
        }
        if (isStringRecordId(obj)) {
            return this.#decodeValue(new StringRecordId(obj.$recordIdString));
        }
        if (isTable(obj)) {
            return this.#decodeValue(new Table(obj.$table));
        }
        if (isGeometry(obj)) {
            return this.#decodeValue(Geometry.fromJSON(obj.$geometry));
        }
        if (isSet(obj)) {
            return this.#decodeValue(new Set(obj.$set.map((v: unknown) => this.#deserialize(v))));
        }
        if (isFile(obj)) {
            return this.#decodeValue(new FileRef(obj.$file.bucket, obj.$file.key));
        }
        if (isRange(obj)) {
            return this.#decodeValue(
                new Range(this.#decodeBound(obj.$range.begin), this.#decodeBound(obj.$range.end)),
            );
        }
        if (isBytes(obj)) {
            return this.#decodeValue(fromBase64Url(obj.$bytes));
        }
        if (isFuture(obj)) {
            return this.#decodeValue(new Future(obj.$future));
        }

        const kind = sizedKind(obj);
        if (kind) {
            const arg = obj[`$${kind}`] as number | string;
            const value = kind === "u64" ? BigInt(arg) : arg === "-0" ? -0 : Number(arg);
            return this.#decodeValue(new (sizedClass(kind))(value as never));
        }

        return this.#decodeValue(
            Object.fromEntries(
                Object.entries(obj)
                    .map(([k, v]) => [k, this.#deserialize(v)])
                    .filter(([, decoded]) => decoded !== undefined),
            ),
        );
    }

    #decodeBound(input: unknown): BoundIncluded<unknown> | BoundExcluded<unknown> | undefined {
        if (this.#isDecodePrimitive(input)) {
            return undefined;
        }

        const obj = input as Record<string, unknown>;

        if (isBoundIncluded(obj)) {
            return new BoundIncluded(this.#deserialize(obj.$boundIncluded));
        }
        if (isBoundExcluded(obj)) {
            return new BoundExcluded(this.#deserialize(obj.$boundExcluded));
        }

        return undefined;
    }

    #isDecodePrimitive(value: unknown): boolean {
        return value === null || value === undefined || typeof value !== "object";
    }

    #resolveSpecDate(v: string): unknown {
        return this.#options.useNativeDates ? new Date(v) : new DateTime(v);
    }

    #encodeValue(v: unknown): unknown {
        return this.#options.valueEncodeVisitor ? this.#options.valueEncodeVisitor(v) : v;
    }

    #decodeValue(v: unknown): unknown {
        return this.#options.valueDecodeVisitor ? this.#options.valueDecodeVisitor(v) : v;
    }
}
