/**
 * The CBOR test vectors of the SurrealDB protocol (spec/vectors in surrealdb-protocol), run
 * through this SDK's codec: plain `cbor` against cbor.yaml, and `cbor.2` against cbor.yaml and
 * cbor2.yaml. The protocol repository is a dev dependency, pinned to a release tag, so bumping
 * the tag brings in the vectors of that release.
 */

import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
    BoundExcluded,
    BoundIncluded,
    CborCodec,
    DateTime,
    Decimal,
    Duration,
    F16,
    F32,
    FileRef,
    Geometry,
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
    Range,
    RecordId,
    RecordIdRange,
    SizedNumber,
    type SizedNumberKind,
    StringRecordId,
    Table,
    U8,
    U16,
    U32,
    U64,
    Uuid,
} from "surrealdb";
import { parse } from "yaml";

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

interface Vector {
    name: string;
    kind: "canonical" | "decode" | "reject";
    value?: Json;
    cbor: string;
    formats?: string[];
}

function protocolDir(): string {
    for (let dir = import.meta.dir; dir !== dirname(dir); dir = dirname(dir)) {
        const candidate = join(dir, "node_modules", "@surrealdb", "protocol");
        if (existsSync(candidate)) return candidate;
    }
    throw new Error("@surrealdb/protocol is not installed");
}

function load(file: string): Vector[] {
    const path = join(protocolDir(), "spec", "vectors", file);
    return (parse(readFileSync(path, "utf8")) as { vectors: Vector[] }).vectors;
}

const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString("hex");
const unhex = (text: string) => new Uint8Array(Buffer.from(text, "hex"));

// --- typed JSON (spec/README.md) -------------------------------------------------------

const SIZED: Record<string, new (value: never) => SizedNumber> = {
    $i8: I8,
    $u8: U8,
    $i16: I16,
    $u16: U16,
    $i32: I32,
    $u32: U32,
    $u64: U64,
    $f16: F16,
    $f32: F32,
};

const TYPED = new Set([
    "$none",
    "$int",
    "$float",
    "$decimal",
    "$string",
    "$bytes",
    "$uuid",
    "$datetime",
    "$duration",
    "$array",
    "$object",
    "$set",
    "$table",
    "$record",
    "$range",
    "$file",
    "$geometry",
    "$regex",
    ...Object.keys(SIZED),
]);

function typedKey(json: Json): string | undefined {
    if (!json || typeof json !== "object" || Array.isArray(json)) return undefined;
    const keys = Object.keys(json);
    return keys.length === 1 && TYPED.has(keys[0] as string) ? keys[0] : undefined;
}

/** A typed JSON float: a number, or "NaN", "Infinity", "-Infinity" or "-0" */
const float = (json: Json) => (json === "-0" ? -0 : Number(json));

function durationNanos(json: Json): bigint {
    const [seconds, nanos] = json as [Json, Json];
    return BigInt(seconds as number | string) * 1_000_000_000n + BigInt(nanos as number);
}

/** The SDK value for a typed JSON value */
function fromJson(json: Json): unknown {
    if (json === null || typeof json !== "object") return json;
    if (Array.isArray(json)) return json.map(fromJson);

    const key = typedKey(json);
    if (!key) return Object.fromEntries(Object.entries(json).map(([k, v]) => [k, fromJson(v)]));

    const arg = (json as Record<string, Json>)[key] as Json;
    const sized = SIZED[key];
    if (sized) {
        const value = key === "$u64" ? BigInt(arg as string | number) : float(arg);
        return new sized(value as never);
    }

    switch (key) {
        case "$none":
            return undefined;
        case "$int":
            return BigInt(arg as string);
        case "$float":
            return float(arg);
        case "$decimal":
            return new Decimal(arg as string);
        case "$string":
            return arg;
        case "$bytes":
            return unhex(arg as string);
        case "$uuid":
            return new Uuid(arg as string);
        case "$datetime":
            return new DateTime(arg as string);
        case "$duration":
            return Duration.nanoseconds(durationNanos(arg));
        case "$array":
            return (arg as Json[]).map(fromJson);
        case "$object":
            return Object.fromEntries(
                Object.entries(arg as Record<string, Json>).map(([k, v]) => [k, fromJson(v)]),
            );
        case "$set":
            return new Set((arg as Json[]).map(fromJson));
        case "$table":
            return new Table(arg as string);
        case "$record": {
            const { table, key: id } = arg as { table: string; key: Json };
            const value = fromJson(id);
            return value instanceof Range
                ? new RecordIdRange(table, value.begin, value.end)
                : new RecordId(table, value as never);
        }
        case "$range": {
            const { start, end } = arg as { start: Json; end: Json };
            return new Range(boundFromJson(start), boundFromJson(end));
        }
        case "$file": {
            const { bucket, key: path } = arg as { bucket: string; key: string };
            return new FileRef(bucket, path);
        }
        case "$geometry":
            return geometryFromJson(arg as unknown as GeoJson);
    }

    throw new Error(`No SDK value for ${key}`);
}

interface GeoJson {
    type: string;
    coordinates?: Json;
    geometries?: GeoJson[];
}

function geometryFromJson(json: GeoJson): Geometry {
    // Coordinates are numbers, or $float for NaN, the infinities and -0
    const coordinate = (c: Json) =>
        typeof c === "number" ? c : float((c as { $float: Json }).$float);
    const point = (p: Json) => new GeometryPoint((p as Json[]).map(coordinate) as [number, number]);
    const line = (l: Json) => new GeometryLine((l as Json[]).map(point) as never);
    const polygon = (p: Json) => new GeometryPolygon((p as Json[]).map(line) as never);
    const coordinates = json.coordinates as Json;

    switch (json.type) {
        case "Point":
            return point(coordinates);
        case "LineString":
            return line(coordinates);
        case "Polygon":
            return polygon(coordinates);
        case "MultiPoint":
            return new GeometryMultiPoint((coordinates as Json[]).map(point) as never);
        case "MultiLineString":
            return new GeometryMultiLine((coordinates as Json[]).map(line) as never);
        case "MultiPolygon":
            return new GeometryMultiPolygon((coordinates as Json[]).map(polygon) as never);
    }

    return new GeometryCollection((json.geometries ?? []).map(geometryFromJson) as never);
}

function boundFromJson(json: Json) {
    if (json === null) return undefined;
    const bound = json as { included?: Json; excluded?: Json };
    return "included" in bound
        ? new BoundIncluded(fromJson(bound.included as Json))
        : new BoundExcluded(fromJson(bound.excluded as Json));
}

/** Whether a decoded value is the typed JSON value */
function matches(expected: Json, actual: unknown): boolean {
    if (expected === null || typeof expected === "boolean") return actual === expected;
    if (typeof expected === "string") return actual === expected;
    if (typeof expected === "number") {
        return typeof actual === "bigint" ? actual === BigInt(expected) : actual === expected;
    }

    if (Array.isArray(expected)) {
        return (
            Array.isArray(actual) &&
            actual.length === expected.length &&
            expected.every((item, i) => matches(item, actual[i]))
        );
    }

    const key = typedKey(expected);
    if (!key) return matchesObject(expected, actual);

    const arg = (expected as Record<string, Json>)[key] as Json;
    const sized = SIZED[key];
    if (sized) {
        if (!(actual instanceof SizedNumber) || actual.kind !== (key.slice(1) as SizedNumberKind))
            return false;
        const value = key === "$u64" ? BigInt(arg as string | number) : float(arg);
        return Object.is(actual.value, value);
    }

    switch (key) {
        case "$none":
            return actual === undefined;
        case "$int":
            return (
                (typeof actual === "bigint" || typeof actual === "number") &&
                BigInt(actual) === BigInt(arg as string)
            );
        case "$float":
            // The SDK reads CBOR floats and integers alike as number, so an integral float
            // reads back as an integer: compare the number
            return typeof actual === "number" && Object.is(actual, float(arg));
        case "$decimal":
            return actual instanceof Decimal && actual.equals(new Decimal(arg as string));
        case "$string":
            return actual === arg;
        case "$bytes":
            return (
                (actual instanceof ArrayBuffer || actual instanceof Uint8Array) &&
                hex(new Uint8Array(actual)) === arg
            );
        case "$uuid":
            return actual instanceof Uuid && actual.toString() === arg;
        case "$datetime":
            return (
                actual instanceof DateTime &&
                actual.nanoseconds === new DateTime(arg as string).nanoseconds
            );
        case "$duration":
            return actual instanceof Duration && actual.nanoseconds === durationNanos(arg);
        case "$array":
            return matches(arg, actual);
        case "$object":
            return matchesObject(arg, actual);
        case "$set": {
            if (!(actual instanceof Set) || actual.size !== (arg as Json[]).length) return false;
            const left = [...actual];
            return (arg as Json[]).every((item) => {
                const i = left.findIndex((candidate) => matches(item, candidate));
                if (i < 0) return false;
                left.splice(i, 1);
                return true;
            });
        }
        case "$table":
            return actual instanceof Table && actual.name === arg;
        case "$record": {
            const { table, key: id } = arg as { table: string; key: Json };
            if (actual instanceof RecordIdRange) {
                return (
                    actual.table.name === table &&
                    typedKey(id) === "$range" &&
                    matchesRange((id as { $range: Json }).$range, actual.begin, actual.end)
                );
            }
            return (
                actual instanceof RecordId && actual.table.name === table && matches(id, actual.id)
            );
        }
        case "$range":
            return actual instanceof Range && matchesRange(arg, actual.begin, actual.end);
        case "$file": {
            const { bucket, key: path } = arg as { bucket: string; key: string };
            return actual instanceof FileRef && actual.bucket === bucket && actual.key === path;
        }
        case "$geometry":
            return actual instanceof Geometry && matchesGeoJson(arg, actual.toJSON());
    }

    return false;
}

function matchesObject(expected: Json, actual: unknown): boolean {
    if (!actual || typeof actual !== "object" || Array.isArray(actual)) return false;
    const entries = Object.entries(expected as Record<string, Json>);
    return (
        Object.keys(actual).length === entries.length &&
        entries.every(([k, v]) => k in actual && matches(v, (actual as Record<string, unknown>)[k]))
    );
}

function matchesRange(expected: Json, begin: unknown, end: unknown): boolean {
    const { start, end: stop } = expected as { start: Json; end: Json };
    return matchesBound(start, begin) && matchesBound(stop, end);
}

function matchesBound(expected: Json, actual: unknown): boolean {
    if (expected === null) return actual === undefined;
    const bound = expected as { included?: Json; excluded?: Json };
    return "included" in bound
        ? actual instanceof BoundIncluded && matches(bound.included as Json, actual.value)
        : actual instanceof BoundExcluded && matches(bound.excluded as Json, actual.value);
}

function matchesGeoJson(expected: Json, actual: unknown): boolean {
    if (typedKey(expected) === "$float")
        return (
            typeof actual === "number" &&
            Object.is(actual, float((expected as { $float: Json }).$float))
        );
    if (typeof expected === "number") return actual === expected;
    if (Array.isArray(expected)) {
        return (
            Array.isArray(actual) &&
            actual.length === expected.length &&
            expected.every((item, i) => matchesGeoJson(item, actual[i]))
        );
    }
    if (expected && typeof expected === "object") {
        return (
            !!actual &&
            typeof actual === "object" &&
            Object.entries(expected).every(([k, v]) =>
                matchesGeoJson(v, (actual as Record<string, unknown>)[k]),
            )
        );
    }
    return actual === expected;
}

// --- the vectors -------------------------------------------------------------------------

const plain = new CborCodec({});
const cbor2 = new CborCodec({ version: 2 });

/**
 * The reject vectors which this SDK decodes rather than refuses. The SDK is a client, not a
 * validator of what the server sends: it refuses what would be read as the wrong value (a
 * sized tag in the wrong dialect or holding the wrong item, a shaped block on a format which
 * does not carry one, an integer past the signed 64-bit range, a record id key of the wrong
 * kind), and leaves the server's other rules to the
 * server. It still reads the text tags 0, 9 and 13, which servers before 4.0 accepted, and an
 * integer past the signed 64-bit range, which the server never sends outside a u64 or the
 * seconds of a duration.
 */
const LENIENT = new Set([
    "reject-int-beyond-i64",
    "reject-untagged-integer-past-i64",
    "reject-uuid-string-tag-9",
    "reject-datetime-string-tag-0",
    "reject-duration-string-tag-13",
    "reject-record-id-string-form-unknown-escape",
    "reject-record-id-string-form-surrogate-escape",
    "reject-record-id-uuid-string-key",
    "reject-duration-negative-seconds",
    "reject-duration-negative-nanoseconds",
    "reject-duration-three-elements",
    "reject-datetime-one-element",
    "reject-datetime-negative-nanoseconds",
    "reject-record-id-three-elements",
    "reject-datetime-after-chrono-max",
    "reject-datetime-before-chrono-min",
    "reject-datetime-seconds-beyond-i64",
    "reject-indefinite-text-split-code-point",
    "reject-record-id-float-key",
    "reject-decimal-not-a-number",
    "reject-decimal-beyond-96-bits",
    "reject-decimal-surrounding-whitespace",
    "reject-decimal-trailing-whitespace",
    "reject-decimal-mantissa-beyond-96-bits",
    "reject-decimal-scale-beyond-28",
    "reject-datetime-string-after-chrono-max",
    "reject-duration-string-beyond-u64",
    "reject-duration-string-nanoseconds-carry-beyond-u64",
    "reject-datetime-impossible-date",
    "reject-polygon-empty",
    "reject-point-one-coordinate",
    "reject-object-integer-key",
    "reject-tag-future",
    "reject-tag-binary-decimal",
    "reject-object-duplicate-key",
    "reject-none-with-payload",
    "reject-unknown-tag",
]);

function check(codec: CborCodec, vector: Vector) {
    const bytes = unhex(vector.cbor);

    if (vector.kind === "reject") {
        expect(() => codec.decode(bytes)).toThrow();
        return;
    }

    const decoded = codec.decode(bytes);

    // The string form of a record id is SurrealQL, which the SDK leaves to the server to parse
    if (vector.name.startsWith("record-id-string-form")) {
        expect(decoded).toBeInstanceOf(StringRecordId);
        return;
    }

    expect(matches(vector.value as Json, decoded)).toBe(true);

    if (vector.kind === "canonical") {
        const value = fromJson(vector.value as Json);
        expect(matches(vector.value as Json, codec.decode(codec.encode(value)))).toBe(true);
    }
}

function suite(codec: CborCodec, format: string, vectors: Vector[]) {
    const applicable = vectors.filter((v) => !v.formats || v.formats.includes(format));
    const enforced = applicable.filter((v) => v.kind !== "reject" || !LENIENT.has(v.name));

    test.each(enforced.map((v) => [v.name, v] as const))("%s", (_, vector) => {
        check(codec, vector);
    });

    test("decodes exactly the reject vectors it is known to be lenient about", () => {
        const lenient = applicable
            .filter((v) => v.kind === "reject" && LENIENT.has(v.name))
            .filter((v) => {
                try {
                    codec.decode(unhex(v.cbor));
                    return true;
                } catch {
                    return false;
                }
            })
            .map((v) => v.name);

        expect(lenient).toEqual(
            applicable.filter((v) => v.kind === "reject" && LENIENT.has(v.name)).map((v) => v.name),
        );
    });
}

describe("protocol vectors: cbor", () => {
    suite(plain, "cbor", load("cbor.yaml"));
});

describe("protocol vectors: cbor.2", () => {
    suite(cbor2, "cbor.2", [...load("cbor.yaml"), ...load("cbor2.yaml")]);

    test("encodes the sized numbers exactly as the server does", () => {
        for (const vector of load("cbor2.yaml")) {
            if (vector.kind !== "canonical") continue;
            expect([vector.name, hex(cbor2.encode(fromJson(vector.value as Json)))]).toEqual([
                vector.name,
                vector.cbor,
            ]);
        }
    });
});
