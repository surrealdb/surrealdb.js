# SQON - SurrealQL Object Notation

Internal lead: Julian Mills
Last edited time: April 7, 2026 8:48 PM
Status: Draft

# SurrealQL Object Notation Specification

SQON (SurrealQL Object Notation) is the family of data representation formats used by SurrealDB to encode its rich data value system. Three representations exist, each optimised for a different environment:

| Name | Encoding | Use case |
| --- | --- | --- |
| SQON | SurrealQL (text) | Direct database interaction, queries, SurrealQL expressions |
| SQON Binary | CBOR (binary) | Efficient wire transport, compact storage, binary-safe environments |
| SQON JSON | JSON (text) | HTTP APIs, browser environments, human-readable interchange |

All three representations are semantically equivalent. Any value expressible in one format can be round-tripped through any other without loss of type information.

## 1. Value types

SQON represents the full SurrealQL value system. Every value in SurrealDB belongs to exactly one of the types listed below. This section provides a comprehensive reference; the format-specific sections that follow describe how each type is encoded in SQON, SQON Binary, and SQON JSON.

### 1.1 Type descriptions

### None

`none` represents the explicit absence of a value. It is distinct from `null` and is used to indicate that a field has no value at all. Responses typically omit `none`-valued fields entirely rather than including them.

### Null

`null` represents an unknown or undefined value. While semantically similar to `none`, `null` conveys "value is unknown" rather than "value is absent".

### Bool

A boolean value: `true` or `false`.

### Number

SurrealDB supports three numeric subtypes, all of which fall under the umbrella `number` type:

| Subtype | Storage | Range / precision | SQON syntax |
| --- | --- | --- | --- |
| `int` | 64-bit signed integer | −9,223,372,036,854,775,808 to 9,223,372,036,854,775,807 | `42` |
| `float` | 64-bit IEEE 754 double | ≈15–17 significant decimal digits | `3.14` or `3.14f` |
| `decimal` | 128-bit decimal floating point | Arbitrary precision, no IEEE 754 rounding | `3.14dec` |

A numeric literal without a decimal point and within the `int` range is stored as an `int`. A literal with a decimal point or outside the `int` range is stored as a `float`.

Underscores in numeric literals are ignored and can be used for readability (e.g. `1_000_000`).

### String

A UTF-8 encoded text value of arbitrary length. Strings can contain Unicode characters, emojis, tabs, and line breaks.

### Duration

A non-negative time span with nanosecond precision. Durations are composed of one or more unit segments:

| Unit | Meaning |
| --- | --- |
| `ns` | Nanoseconds |
| `us` / `µs` | Microseconds |
| `ms` | Milliseconds |
| `s` | Seconds |
| `m` | Minutes |
| `h` | Hours |
| `d` | Days |
| `w` | Weeks |
| `y` | Years |

Units can be combined in a single literal: `1y2w3d4h5m6s7ms8us9ns`. A duration can be zero (`0ns`) but cannot be negative.

### Datetime

An RFC 3339 / ISO 8601 timestamp with nanosecond precision. Datetimes are stored internally as UTC; a timezone offset in the input is converted to UTC on storage.

### UUID

A universally unique identifier conforming to RFC 4122. SurrealDB supports UUID v4 (random) and v7 (time-ordered).

### Array

An ordered, indexed collection of values. Arrays may contain values of any type, including nested arrays and objects. Individual elements are accessed by zero-based index. An optional element type and length constraint can be specified in schema definitions (e.g. `array<string, 5>`).

### Set

An ordered, automatically deduplicated collection of values. Sets differ from arrays in two ways: duplicate values are removed, and values are sorted. Sets support the same element type and length constraints as arrays in schema definitions.

### Object

An unordered key-value map with string keys and values of any type. Objects may be nested and can contain any other value type.

### Geometry

A geospatial value conforming to RFC 7946 (GeoJSON). SurrealDB supports the following geometry subtypes:

| Subtype | Description |
| --- | --- |
| `Point` | A single position (longitude, latitude) |
| `LineString` | An ordered sequence of positions |
| `Polygon` | A closed shape with an exterior ring and optional interior rings (holes) |
| `MultiPoint` | A collection of points |
| `MultiLineString` | A collection of line strings |
| `MultiPolygon` | A collection of polygons |
| `GeometryCollection` | A heterogeneous collection of geometry objects |

### Bytes

Raw binary data. Bytes are typically displayed in hexadecimal encoding.

### Table

A bare reference to a table name (opposed to a specific record). Table values are often used to distinguish between a table name and a record ID in contexts where both are possible.

### Record ID

A record ID uniquely identifies a single record within a table. It is composed of two parts: a **table name** and an **identifier**.

The identifier can take several forms:

| Form | Example (SQON) |
| --- | --- |
| Text | `user:tobie` |
| Numeric (64-bit int) | `user:42` |
| UUID | `user:⟨01924b3c-f1a2-7e3d-a001-2f4b8c9d0e1f⟩` |
| Array (composite key) | `temperature:['London', d'2025-02-13']` |
| Object (structured key) | `user:{ name: 'john', age: 30 }` |
| Generated | `user:rand()`, `user:ulid()`, `user:uuid()` |

Record IDs are immutable and double as record links — holding a record ID is sufficient to traverse to another record's data.

### File

A reference to a file in a storage bucket.

### Range

A bounded or unbounded range of values. Ranges are composed of the `..` operator with optional lower and upper bounds:

| Syntax | Meaning |
| --- | --- |
| `a..b` | From `a` (inclusive) to `b` (exclusive) |
| `a..=b` | From `a` (inclusive) to `b` (inclusive) |
| `a>..b` | From `a` (exclusive) to `b` (exclusive) |
| `a>..=b` | From `a` (exclusive) to `b` (inclusive) |
| `a..` | From `a` (inclusive), unbounded above |
| `..b` | Unbounded below, to `b` (exclusive) |
| `..` | Fully unbounded (infinite range) |

Ranges can be constructed from any value type supporting comparison.

## 2. SQON

**MIME:** `application/vnd.surrealdb.sqon`

SQON is the native textual syntax of SurrealDB. While inspired by JSON, it more closely resembles ECMAScript objects, including the ability for object keys to omit quotes, and the ability to use both single and double quotes for strings. It is optimised for direct use within the database — in queries, schema definitions, and results returned over the SurrealDB binary protocol.

Since SQON is a subset of SurrealQL, it is not designed for portability across application boundaries. Parsing SQON requires a custom parser implementation, making it unsuitable for use in general-purpose HTTP environments or third-party clients that do not embed the SurrealDB parser.

### 2.1 Characteristics

- **Concise** — SQON as well as SurrealQL are designed to be flexible and easy to write and read
- **Specialised** — the syntax is custom to SurrealDB and designed for optimal user experience
- **Readable** — custom syntax for each type makes types explicit and clearly distinct from each other

### 2.2 Summary of SQON value syntax

The following table summarises SQON syntax for all value types. Primitive JSON-compatible types use familiar syntax; SurrealDB-specific types use bespoke syntax.

### Primitive types (JSON-compatible)

| Type | SQON example |
| --- | --- |
| None | `NONE` |
| Null | `NULL` |
| Bool | `true` / `false` |
| Int | `42` |
| Float | `3.14` / `3.14f` |
| String | `'hello'` / `"hello"` |
| Array | `[1, 2, 3]` |
| Object | `{ name: 'Jane', age: 30 }` |

### SurrealDB-specific types

| Type | SQON example |
| --- | --- |
| Decimal | `3.14159265358979dec` |
| Duration | `1h30m` / `2w3d` / `100ms` |
| Datetime | `d"2024-01-15T09:30:00Z"` |
| UUID | `u"01924b3c-f1a2-7e3d-a001-2f4b8c9d0e1f"` |
| Set | `{1, 2, 3}` |
| Bytes | `b"48656C6C6F"` |
| Table | `person` (bare identifier) |
| Record ID | `user:abc123` |
| Record ID (numeric) | `user:42` |
| Record ID (UUID) | `user:⟨01924b3c-f1a2-7e3d-a001-2f4b8c9d0e1f⟩` |
| Record ID (object) | `user:{ name: 'john', age: 30 }` |
| Record ID (array) | `temperature:['London', d'2025-02-13']` |
| File | `f"bucket:/path/to/file.txt"` |
| Range | `0..10` / `0..=10` / `0>..10` |
| Geometry (point) | `(-122.4194, 37.7749)` |

## 3. SQON Binary

**MIME:** `application/vnd.surrealdb.sqon+cbor`

SQON Binary is the binary serialisation format for SQON values. The current implementation is based on **CBOR** (Concise Binary Object Representation, RFC 8949) with the addition of custom tags to represent SurrealDB-specific types. It is the current wire format used by the SurrealDB WebSocket and HTTP binary endpoints. Note that in the future we intend on replacing CBOR communication with flat buffers.

Each SurrealDB-specific type is assigned a custom CBOR tag that unambiguously identifies its type and governs how its payload is decoded.

### 3.1 Characteristics

- **Compact** — binary encoding is significantly smaller than equivalent JSON for numeric and binary payloads.
- **Efficient** — suitable for high-throughput, low-latency environments.
- **Not human-readable** — requires a CBOR-aware decoder; not suitable for direct use in HTTP response bodies consumed by browsers or curl.

### 3.2 Native CBOR types (no custom tag)

The following types map directly to native CBOR major types and require no custom tag:

| SQON type | CBOR encoding |
| --- | --- |
| `null` | CBOR `null` (major type 7, value 22) |
| `bool` | CBOR `true` / `false` (major type 7) |
| `int` | CBOR integer (major type 0 or 1) |
| `float` | CBOR float (major type 7, half/single/double) |
| `string` | CBOR text string (major type 3) |
| `bytes` | CBOR byte string (major type 2) |
| `array` | CBOR array (major type 4) |
| `object` | CBOR map (major type 5) |

### 3.3 Custom tag assignments

| SQON type | CBOR tag | Payload |
| --- | --- | --- |
| `None` | 6 | `null` |
| `Table` | 7 | Text string (table name) |
| `RecordId` | 8 | `[table: text, id: any]` |
| `UUID` | 9 or 37 | 16-byte bytestring (tag 37 is the IANA-registered UUID tag; tag 9 decodes a string-encoded UUID) |
| `Decimal` | 10 | Text string (decimal notation) |
| `Datetime` | 12 | `[seconds: uint, nanoseconds: uint]` (tag 0 is also accepted for RFC 3339 text string input) |
| `Duration` | 13 or 14 | Tag 13: text string; Tag 14: `[seconds: uint, nanoseconds: uint]` |
| `Future` | 15 | Text string (SurrealQL expression body) |
| `Range` | 49 | `[begin: Bound, end: Bound]` |
| `BoundIncluded` | 50 | The included bound value |
| `BoundExcluded` | 51 | The excluded bound value |
| `File` | 55 | `[bucket: text, key: text]` |
| `Set` | 56 | CBOR array of values |
| `Geometry (Point)` | 88 | `[longitude: float, latitude: float]` |
| `Geometry (LineString)` | 89 | Array of coordinate pairs |
| `Geometry (Polygon)` | 90 | Array of linear rings |
| `Geometry (MultiPoint)` | 91 | Array of points |
| `Geometry (MultiLineString)` | 92 | Array of line strings |
| `Geometry (MultiPolygon)` | 93 | Array of polygons |
| `Geometry (Collection)` | 94 | Array of geometry objects |

## 4. SQON JSON

**MIME:** `application/vnd.surrealdb.sqon+json`

SQON JSON is the JSON-compatible serialisation format for SQON values. It enables full type fidelity in environments where only JSON is available — HTTP APIs, browser clients, logging infrastructure, debugging tools, and any context where binary encoding is impractical. While SQON JSON is the least compact representation of SurrealDB types, it is the most portable and widely accepted format.

The SQON JSON format builds on top of JSON, with the addition of `$` prefixed notations describing custom SurrealDB types. This mirrors the EJSON specification from MongoDB.

### 4.1 Characteristics

- **Portable** - usable in any environment where data is represented by JSON
- **LLM Friendly** - allowing for optimal communication with LLMs through JSON
- **Readable** - unlike SQON-B this is directly readable, albeit not as concise as base SQON

### 4.2 Type encodings

### 4.2.1 Primitive passthrough

JSON-native types are passed through without wrapping.

| SQON type | SQON JSON encoding |
| --- | --- |
| `null` | `null` |
| `bool` | `true` / `false` |
| `int` | `42` |
| `float` | `3.14` |
| `string` | `"hello"` |
| `array` | `[...]` |
| `object` | `{...}` |

### 4.2.2 None

A `$none` key with a value of `true` is used to represent a `none` value.

```json
{ "$none": true }
```

### 4.2.3 UUID

A `$uuid` key with a value of a UUID string is used to represent a `uuid` value.

```json
{ "$uuid": "01924b3c-f1a2-7e3d-a001-2f4b8c9d0e1f" }
```

### 4.2.4 Datetime

A `$datetime` key with a value of a RFC 3339 / ISO 8601 string is used to represent a `datetime` value.

```json
{ "$datetime": "2024-01-15T09:30:00Z" }
```

### 4.2.5 Duration

A `$duration` key with a value of a SurrealDB duration string is used to represent a `duration` value.

```json
{ "$duration": "1h30m" }
```

### 4.2.6 Decimal

A `$decimal` key with a value of an arbitrary-precision decimal string is used to represent a `decimal` value.

```json
{ "$decimal": "3.14159265358979323846" }
```

### 4.2.7 Bytes

A `$bytes` key with a value of a Base64url-encoded (no padding) bytestring is used to represent a `bytes` value.

```json
{ "$bytes": "aGVsbG8" }
```

### 4.2.8 RecordId

A `$recordId` key with an object containing a `tb` property with a value of a table name and a `id` property with a value of a record ID is used to represent a `recordId` value.

**Text ID:**

```json
{ "$recordId": { "tb": "user", "id": "abc123" } }
```

**Numeric ID:**

```json
{ "$recordId": { "tb": "order", "id": 42 } }
```

**UUID ID:**

```json
{ "$recordId": { "tb": "user", "id": { "$uuid": "01924b3c-f1a2-7e3d-a001-2f4b8c9d0e1f" } } }
```

**Object ID:**

```json
{ "$recordId": { "tb": "user", "id": { "name": "john", "age": 30 } } }
```

**Array ID:**

```json
{ "$recordId": { "tb": "temperature", "id": [51.5074, -0.1278] } }
```

### 4.2.9 Table

A bare table reference (not a record ID).

```json
{ "$table": "user" }
```

### 4.2.10 Geometry

A `$geometry` key with an object conforming to the GeoJSON specification is used to represent a `geometry` value.

**Point:**

```json
{ "$geometry": { "type": "Point", "coordinates": [-122.4194, 37.7749] } }
```

**Polygon:**

```json
{ "$geometry": { "type": "Polygon", "coordinates": [[[0,0],[1,0],[1,1],[0,1],[0,0]]] } }
```

### 4.2.11 Set

A `$set` key with a value of a JSON array is used to represent a `set` value.

```json
{ "$set": [1, 2, 3] }
```

### 4.2.12 File

A `$file` key with an object containing a `bucket` property with a value of a bucket name and a `key` property with a value of a file key (path) is used to represent a `file` value.

```json
{ "$file": { "bucket": "images", "key": "/photos/avatar.png" } }
```

### 4.2.13 Range

A `$range` key with an object containing a `begin` property with a value of a bound and an `end` property with a value of a bound is used to represent a `range` value.

```json
{ "$range": { "begin": { "$boundIncluded": 0 }, "end": { "$boundExcluded": 10 } } }
```

**Inclusive upper bound:**

```json
{ "$range": { "begin": { "$boundIncluded": 0 }, "end": { "$boundIncluded": 10 } } }
```

**Unbounded (open-ended):**

```json
{ "$range": { "begin": { "$boundIncluded": 0 }, "end": null } }
```

### 4.3 Full document example

A SurrealDB record serialised as SQON-J:

```json
{
  "id": { "$recordId": { "tb": "user", "id": { "$uuid": "01924b3c-f1a2-7e3d-a001-2f4b8c9d0e1f" } } },
  "name": "Jane Smith",
  "created_at": { "$datetime": "2024-01-15T09:30:00Z" },
  "session_duration": { "$duration": "1h45m" },
  "balance": { "$decimal": "1042.50" },
  "location": { "$geometry": { "type": "Point", "coordinates": [-0.1278, 51.5074] } },
  "tags": { "$set": ["admin", "verified"] },
  "avatar": { "$file": { "bucket": "uploads", "key": "/avatars/jane.png" } },
  "metadata": {
    "score": 9.8,
    "flags": 3
  }
}
```

## 5. Choosing a representation

| Situation | Recommended format |
| --- | --- |
| Writing a SurrealQL query | SQON |
| SurrealDB native WebSocket / binary protocol | SQON-B |
| General purpose REST API response body | SQON-J |
| Browser client receiving query results | SQON-J |
| Storing a record in a log or audit trail | SQON-J |
| Embedding SurrealDB values in a JSON config file | SQON-J |
| High-throughput internal service-to-service transport | SQON-B |
| Debugging / human inspection of a record | SQON-J or SQON |