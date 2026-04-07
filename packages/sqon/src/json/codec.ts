import { fromBase64Url, toBase64Url } from "../internal/base64.ts";
import type { CodecOptions, ValueCodec } from "../types/codec.ts";
import { BoundExcluded, BoundIncluded } from "../utils/range.ts";
import {
    DateTime,
    Decimal,
    Duration,
    FileRef,
    Future,
    Geometry,
    Range,
    RecordId,
    RecordIdRange,
    type RecordIdValue,
    StringRecordId,
    Table,
    Uuid,
} from "../value/index.ts";
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
    createRange,
    createRecordId,
    createSet,
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
    isRange,
    isRecordId,
    isSet,
    isTable,
    isUuid,
} from "./values.ts";

/**
 * A codec for encoding and decoding SurrealQL values using SQON-J (JSON representation).
 *
 * The output is a plain JSON-compatible object tree, not a serialised string.
 */
export class JsonCodec implements ValueCodec<unknown> {
    static default = new JsonCodec({});

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
        if (value instanceof Date) {
            return createDatetime(value.toISOString());
        }
        if (value instanceof Uint8Array) {
            return createBytes(toBase64Url(value));
        }
        if (value instanceof Geometry) {
            return createGeometry(value.toJSON());
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
                return Object.fromEntries(
                    Object.entries(value as object)
                        .map(([k, v]) => [k, this.#serialize(v)])
                        .filter(([, encoded]) => encoded !== undefined),
                );
            }
        }

        return value;
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
            return input;
        }

        if (Array.isArray(input)) {
            return input.map((v) => this.#deserialize(v));
        }

        const obj = input as Record<string, unknown>;

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

        return Object.fromEntries(
            Object.entries(obj)
                .map(([k, v]) => [k, this.#deserialize(v)])
                .filter(([, decoded]) => decoded !== undefined),
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
