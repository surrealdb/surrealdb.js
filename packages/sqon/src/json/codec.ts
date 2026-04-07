import type { CodecOptions, ValueCodec } from "../types/codec.ts";
import { BoundExcluded, BoundIncluded } from "../utils/range.ts";
import {
    DateTime,
    Decimal,
    Duration,
    FileRef,
    Future,
    Geometry,
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
} from "../value/index.ts";

function toBase64Url(bytes: Uint8Array): string {
    let binary = "";
    for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(str: string): Uint8Array {
    const padded = str.replace(/-/g, "+").replace(/_/g, "/");
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
}

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
        return this.#encodeValue(data);
    }

    /**
     * Decode a SQON-J structure back to value instances.
     */
    decode<T>(data: unknown): T {
        return this.#decodeValue(data) as T;
    }

    #encodeValue(input: unknown): unknown {
        const value = this.#options.valueEncodeVisitor
            ? this.#options.valueEncodeVisitor(input)
            : input;

        if (value === undefined) return { $none: true };
        if (value === null || typeof value === "boolean" || typeof value === "string") return value;
        if (typeof value === "number" || typeof value === "bigint") return value;

        if (value instanceof DateTime) {
            return { $datetime: value.toISOString() };
        }
        if (value instanceof Decimal) {
            return { $decimal: value.toString() };
        }
        if (value instanceof Duration) {
            return { $duration: value.toString() };
        }
        if (value instanceof Uuid) {
            return { $uuid: value.toString() };
        }
        if (value instanceof RecordId) {
            return {
                $recordId: {
                    tb: value.table.name,
                    id: this.#encodeValue(value.id),
                },
            };
        }
        if (value instanceof StringRecordId) {
            return {
                $recordId: {
                    tb: value.toString().split(":")[0],
                    id: value.toString().split(":").slice(1).join(":"),
                },
            };
        }
        if (value instanceof RecordIdRange) {
            return {
                $recordId: {
                    tb: value.table.name,
                    id: {
                        $range: {
                            begin: this.#encodeBound(value.begin),
                            end: this.#encodeBound(value.end),
                        },
                    },
                },
            };
        }
        if (value instanceof Table) {
            return { $table: value.name };
        }
        if (value instanceof Range) {
            return {
                $range: {
                    begin: this.#encodeBound(value.begin),
                    end: this.#encodeBound(value.end),
                },
            };
        }
        if (value instanceof FileRef) {
            return { $file: { bucket: value.bucket, key: value.key } };
        }
        if (value instanceof Future) {
            return { $future: value.body };
        }
        if (value instanceof Date) {
            return { $datetime: value.toISOString() };
        }
        if (value instanceof Uint8Array) {
            return { $bytes: toBase64Url(value) };
        }
        if (value instanceof GeometryPoint) {
            return { $geometry: { type: "Point", coordinates: value.point } };
        }
        if (value instanceof GeometryLine) {
            return {
                $geometry: {
                    type: "LineString",
                    coordinates: value.line.map((p) => p.coordinates),
                },
            };
        }
        if (value instanceof GeometryPolygon) {
            return {
                $geometry: {
                    type: "Polygon",
                    coordinates: value.polygon.map((l) => l.coordinates),
                },
            };
        }
        if (value instanceof GeometryMultiPoint) {
            return {
                $geometry: {
                    type: "MultiPoint",
                    coordinates: value.points.map((p) => p.coordinates),
                },
            };
        }
        if (value instanceof GeometryMultiLine) {
            return {
                $geometry: {
                    type: "MultiLineString",
                    coordinates: value.lines.map((l) => l.coordinates),
                },
            };
        }
        if (value instanceof GeometryMultiPolygon) {
            return {
                $geometry: {
                    type: "MultiPolygon",
                    coordinates: value.polygons.map((p) => p.coordinates),
                },
            };
        }
        if (value instanceof GeometryCollection) {
            return {
                $geometry: {
                    type: "GeometryCollection",
                    geometries: value.collection.map((g) => {
                        const encoded = this.#encodeValue(g);
                        return (encoded as { $geometry: unknown }).$geometry;
                    }),
                },
            };
        }
        if (value instanceof Geometry) {
            return { $geometry: value.toJSON() };
        }
        if (value instanceof Set) {
            return { $set: [...value].map((v) => this.#encodeValue(v)) };
        }

        switch (Object.getPrototypeOf(value)) {
            case Object.prototype: {
                const result: Record<string, unknown> = {};
                for (const [k, v] of Object.entries(value as object)) {
                    const encoded = this.#encodeValue(v);
                    if (encoded !== undefined) {
                        result[k] = encoded;
                    }
                }
                return result;
            }
            case Array.prototype:
                return (value as unknown[]).map((v) => this.#encodeValue(v));
            case Map.prototype: {
                const result: Record<string, unknown> = {};
                for (const [k, v] of (value as Map<string, unknown>).entries()) {
                    result[k] = this.#encodeValue(v);
                }
                return result;
            }
        }

        return value;
    }

    #encodeBound(bound: unknown): unknown {
        if (bound instanceof BoundIncluded) {
            return { $boundIncluded: this.#encodeValue(bound.value) };
        }
        if (bound instanceof BoundExcluded) {
            return { $boundExcluded: this.#encodeValue(bound.value) };
        }
        return null;
    }

    #decodeValue(input: unknown): unknown {
        if (input === null || input === undefined) return input;
        if (typeof input !== "object") return input;

        if (Array.isArray(input)) {
            return input.map((v) => this.#decodeValue(v));
        }

        const obj = input as Record<string, unknown>;

        if ("$none" in obj && obj.$none === true) {
            return this.#applyDecodeVisitor(undefined);
        }
        if ("$datetime" in obj && typeof obj.$datetime === "string") {
            return this.#applyDecodeVisitor(
                this.#options.useNativeDates
                    ? new Date(obj.$datetime)
                    : new DateTime(obj.$datetime),
            );
        }
        if ("$decimal" in obj && typeof obj.$decimal === "string") {
            return this.#applyDecodeVisitor(new Decimal(obj.$decimal));
        }
        if ("$duration" in obj && typeof obj.$duration === "string") {
            return this.#applyDecodeVisitor(new Duration(obj.$duration));
        }
        if ("$uuid" in obj && typeof obj.$uuid === "string") {
            return this.#applyDecodeVisitor(new Uuid(obj.$uuid));
        }
        if ("$recordId" in obj && typeof obj.$recordId === "object" && obj.$recordId !== null) {
            const rid = obj.$recordId as { tb: string; id: unknown };
            const decodedId = this.#decodeValue(rid.id);
            if (typeof decodedId === "object" && decodedId !== null && decodedId instanceof Range) {
                return this.#applyDecodeVisitor(
                    new RecordIdRange(rid.tb, decodedId.begin, decodedId.end),
                );
            }
            return this.#applyDecodeVisitor(new RecordId(rid.tb, decodedId as never));
        }
        if ("$table" in obj && typeof obj.$table === "string") {
            return this.#applyDecodeVisitor(new Table(obj.$table));
        }
        if ("$geometry" in obj && typeof obj.$geometry === "object" && obj.$geometry !== null) {
            return this.#applyDecodeVisitor(this.#decodeGeometry(obj.$geometry));
        }
        if ("$set" in obj && Array.isArray(obj.$set)) {
            return this.#applyDecodeVisitor(
                new Set(obj.$set.map((v: unknown) => this.#decodeValue(v))),
            );
        }
        if ("$file" in obj && typeof obj.$file === "object" && obj.$file !== null) {
            const file = obj.$file as { bucket: string; key: string };
            return this.#applyDecodeVisitor(new FileRef(file.bucket, file.key));
        }
        if ("$range" in obj && typeof obj.$range === "object" && obj.$range !== null) {
            const range = obj.$range as { begin: unknown; end: unknown };
            const beg = this.#decodeBound(range.begin);
            const end = this.#decodeBound(range.end);
            return this.#applyDecodeVisitor(new Range(beg, end));
        }
        if ("$bytes" in obj && typeof obj.$bytes === "string") {
            return this.#applyDecodeVisitor(fromBase64Url(obj.$bytes));
        }
        if ("$future" in obj && typeof obj.$future === "string") {
            return this.#applyDecodeVisitor(new Future(obj.$future));
        }
        if ("$regex" in obj && typeof obj.$regex === "string") {
            return this.#applyDecodeVisitor(new RegExp(obj.$regex));
        }
        if ("$boundIncluded" in obj) {
            return new BoundIncluded(this.#decodeValue(obj.$boundIncluded));
        }
        if ("$boundExcluded" in obj) {
            return new BoundExcluded(this.#decodeValue(obj.$boundExcluded));
        }

        const result: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(obj)) {
            result[k] = this.#decodeValue(v);
        }
        return result;
    }

    #decodeBound(input: unknown): BoundIncluded<unknown> | BoundExcluded<unknown> | undefined {
        if (input === null || input === undefined) return undefined;
        if (typeof input !== "object") return undefined;

        const obj = input as Record<string, unknown>;
        if ("$boundIncluded" in obj) {
            return new BoundIncluded(this.#decodeValue(obj.$boundIncluded));
        }
        if ("$boundExcluded" in obj) {
            return new BoundExcluded(this.#decodeValue(obj.$boundExcluded));
        }
        return undefined;
    }

    #decodeGeometry(geo: unknown): Geometry {
        const g = geo as { type: string; coordinates?: unknown; geometries?: unknown[] };
        switch (g.type) {
            case "Point":
                return new GeometryPoint(g.coordinates as [number, number]);
            case "LineString": {
                const coords = g.coordinates as [number, number][];
                return new GeometryLine(
                    coords.map((c) => new GeometryPoint(c)) as [
                        GeometryPoint,
                        GeometryPoint,
                        ...GeometryPoint[],
                    ],
                );
            }
            case "Polygon": {
                const rings = g.coordinates as [number, number][][];
                return new GeometryPolygon(
                    rings.map(
                        (ring) =>
                            new GeometryLine(
                                ring.map((c) => new GeometryPoint(c)) as [
                                    GeometryPoint,
                                    GeometryPoint,
                                    ...GeometryPoint[],
                                ],
                            ),
                    ) as [GeometryLine, ...GeometryLine[]],
                );
            }
            case "MultiPoint": {
                const coords = g.coordinates as [number, number][];
                return new GeometryMultiPoint(
                    coords.map((c) => new GeometryPoint(c)) as [GeometryPoint, ...GeometryPoint[]],
                );
            }
            case "MultiLineString": {
                const lines = g.coordinates as [number, number][][];
                return new GeometryMultiLine(
                    lines.map(
                        (line) =>
                            new GeometryLine(
                                line.map((c) => new GeometryPoint(c)) as [
                                    GeometryPoint,
                                    GeometryPoint,
                                    ...GeometryPoint[],
                                ],
                            ),
                    ) as [GeometryLine, ...GeometryLine[]],
                );
            }
            case "MultiPolygon": {
                const polygons = g.coordinates as [number, number][][][];
                return new GeometryMultiPolygon(
                    polygons.map(
                        (rings) =>
                            new GeometryPolygon(
                                rings.map(
                                    (ring) =>
                                        new GeometryLine(
                                            ring.map((c) => new GeometryPoint(c)) as [
                                                GeometryPoint,
                                                GeometryPoint,
                                                ...GeometryPoint[],
                                            ],
                                        ),
                                ) as [GeometryLine, ...GeometryLine[]],
                            ),
                    ) as [GeometryPolygon, ...GeometryPolygon[]],
                );
            }
            case "GeometryCollection": {
                const geoms = (g.geometries ?? []).map((geo) => this.#decodeGeometry(geo));
                return new GeometryCollection(geoms as [Geometry, ...Geometry[]]);
            }
            default:
                throw new Error(`Unknown geometry type: ${g.type}`);
        }
    }

    #applyDecodeVisitor(v: unknown): unknown {
        return this.#options.valueDecodeVisitor ? this.#options.valueDecodeVisitor(v) : v;
    }
}
