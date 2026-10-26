# Shaped frames

A reading guide to the `shaped` result format, as this SDK decodes it.

The format itself is specified by the server, in `doc/design/shaped-frames.md` of the
SurrealDB repository ("Wire format v1"), and catalogued in the surrealdb-protocol spec
(`spec/cbor-tags.yaml` for tag 57, `spec/catalogs/http.yaml` for negotiation). This file is
the short version, written for someone reading `src/codec/shaped/`.

## What it is

`shaped` is `cbor.2` with one addition: a list of result rows is written as a **block** instead
of a CBOR array. A block announces the rows' shape once, and then carries rows as values only,
with no field names and no per-value type tags.

Everything which is not a row list — the response envelope, the `begin`, `value`, `finished`
and `end` frames of a stream, a notification's `id`, `action` and `record`, errors — is CBOR
exactly as the CBOR format writes it. So a client needs one block decoder plus the CBOR decoder
it already has.

Rows decode to the same values the CBOR path produces. The format is a cheaper way to carry
the same answer, not a different answer.

## Where a block appears, and the scope its shape ids live in

| Where | Scope |
|---|---|
| a `query` response | the block alone |
| a `query_stream` `rows` frame | the whole stream — a shape announced in one frame holds for every later frame |
| a live notification | the live query id, for the life of the subscription |

This is why `ShapedBlock` holds bytes rather than rows: the envelope has to be decoded first to
learn which scope a block belongs to. `BlockReader` is one scope.

## The bytes

A block is CBOR tag 57 around a byte string. Its contents:

```
block    = version:u8  message*
version  = 0x01
message  = type:u8  length:u32  payload[length]

0x01 SHAPE = shape_id:u32  shape
0x02 BATCH = shape_id:u32  row_count:u32  row[row_count]
```

A reader skips a message type it does not know. A BATCH names a shape announced earlier in the
same scope; announcing an id again replaces it for the batches which follow.

A shape:

```
shape   = root:u8  presence_bits:u32  fixed_size:u32  var_count:u32  root_rest:u32
          column_count:u32  column[column_count]
column  = name_len:u16  name[name_len]  kind:u8  element:u8  flags:u8  presence:u32
          slot:u32  table_len:u16  table[table_len]  children:u32  rest:u32
```

`root` is `0` OBJECT (each row is an object built from the columns) or `1` VALUE (each row is
one value, in the dynamic slot `root_rest`). Columns are depth-first, siblings in the byte
order of their UTF-8; a column of kind `object` is followed by its subtree, and `children`
counts it.

And a row:

```
row = presence[ceil(presence_bits / 8)]  fixed[fixed_size]  ends[var_count]:u32  var[L]
```

`ends[i]` is where var slot `i` stops, counted from the start of `var`, so slot `i` is
`var[ends[i-1] .. ends[i]]` with `0` before the first. A row's length is therefore known from
its own bytes, and a batch is its rows back to back.

All integers are little-endian and unaligned.

## Presence

A column which can never be missing has no presence bits. Otherwise its flags give it one bit
or two, starting at `presence`:

| flags | bits | meaning |
|---|---|---|
| `MAY_BE_ABSENT` | 1 | set: a value. clear: absent |
| `MAY_BE_NULL` | 1 | set: a value. clear: `NULL` |
| both | 2 | `0b00` absent, `0b01` a value, `0b10` `NULL`, `0b11` present and `NONE` |

`NONE` has its own state so that a key whose value is `NONE` round-trips as `NONE` rather than
as a key the row does not hold.

A column which is absent, `NULL` or `NONE` has its fixed slot zeroed and its var slot empty.
**A field hidden by a row-dependent permission is absent, byte for byte identical to a row
which simply does not hold that field** — the stream never says that a hidden value exists. A
field the caller may never see has no column at all, and its name appears nowhere.

## Kinds

| code | kind | region | width |
|---|---|---|---|
| `0x01` | `bool` | fixed | 1 |
| `0x02` | `int` | fixed | 8 (`i64`) |
| `0x03` | `float` | fixed | 8 (binary64) |
| `0x04` | `datetime` | fixed | 12 (`secs:i64`, `nanos:u32`) |
| `0x05` | `duration` | fixed | 12 (`secs:u64`, `nanos:u32`) |
| `0x06` | `uuid` | fixed | 16 |
| `0x07` | `bit` | fixed | 1 bit |
| `0x08`–`0x0a` | `i8` `i16` `i32` | fixed | 1, 2, 4 |
| `0x0b`–`0x0d` | `u8` `u16` `u32` | fixed | 1, 2, 4 |
| `0x0e` | `u64` | fixed | 8 |
| `0x0f` | `f32` | fixed | 4 |
| `0x17` | `f16` | fixed | 2 |
| `0x18` | `datetime_ns` | fixed | 8 (`i64` ns; `i64::MIN`/`MAX` escape to the overflow slot) |
| `0x19` | `duration_ns` | fixed | 8 (`u64` ns; `u64::MAX` escapes) |
| `0x10` | `string` | var | UTF-8 |
| `0x11` | `bytes` | var | the bytes |
| `0x12` | `decimal` | var | the decimal's text |
| `0x13` | `record` | var | key kind byte, then the id |
| `0x14` | `dynamic` | var | exactly one CBOR item |
| `0x16` | `array` | var | `count:u32`, then elements of one kind |
| `0x20` | `object` | none | built from the columns which follow |

The sized kinds keep their kind: a `u8` column reads back as `U8`, not as a plain number, the
same way `cbor.2`'s tags 180–188 do.

A `dynamic` column is how the format carries what has no fixed kind: `any` fields, `FLEXIBLE`
fields, the remainder of an open object, schemaless documents, DIFF patches.

## A worked example

A shape of two columns — `name`, a required string, and `age`, an int which may be absent or
`NULL` — carrying two rows: `{ age: 30, name: "ada" }` and `{ name: "bo" }`.

The SHAPE message:

```
01                        message type: SHAPE
4e 00 00 00               payload length: 78
01 00 00 00               shape id: 1
00                        root: OBJECT
02 00 00 00               presence_bits: 2
08 00 00 00               fixed_size: 8
01 00 00 00               var_count: 1
ff ff ff ff               root_rest: NO_SLOT (the root is closed)
02 00 00 00               column_count: 2

03 00 61 67 65            name: "age"
02                        kind: int
00                        element: none
03                        flags: MAY_BE_ABSENT | MAY_BE_NULL
00 00 00 00               presence: bit 0 (two bits, 0 and 1)
00 00 00 00               slot: fixed offset 0
00 00                     table: ""
00 00 00 00               children: 0
ff ff ff ff               rest: NO_SLOT

04 00 6e 61 6d 65         name: "name"
10                        kind: string
00                        element: none
00                        flags: required
ff ff ff ff               presence: NO_SLOT
00 00 00 00               slot: var slot 0
00 00                     table: ""
00 00 00 00               children: 0
ff ff ff ff               rest: NO_SLOT
```

Note the columns are in byte order: `age` before `name`.

The two rows:

```
row 0:
01                        presence: 0b01 — age holds a value
1e 00 00 00 00 00 00 00   fixed: age = 30
03 00 00 00               ends[0]: var slot 0 stops at byte 3
61 64 61                  var: "ada"

row 1:
00                        presence: 0b00 — age is absent
00 00 00 00 00 00 00 00   fixed: zeroed, because age holds nothing
02 00 00 00               ends[0]: var slot 0 stops at byte 2
62 6f                     var: "bo"
```

which decodes to

```json
[{ "age": 30, "name": "ada" }, { "name": "bo" }]
```

Row 1 is what a hidden field looks like too. Nothing distinguishes "this row has no age" from
"you may not see this row's age".

## Reading the code

| file | what it owns |
|---|---|
| `reader.ts` | `ByteReader`, a cursor with one method per kind of number; `Slices`, a run of slices addressed by an ends table |
| `kinds.ts` | the kind codes and what each one implies: width, fixed or var, usable as an array element |
| `shape.ts` | parsing a SHAPE payload and checking it once, so rows need not be re-checked |
| `row.ts` | one row: presence states, the fixed region, the var slices, and assembling a node |
| `values.ts` | one value of a kind — shared by a column's slot and an array's element |
| `block.ts` | the message framing, and the scope which holds announced shapes |
| `codec.ts` | `cbor.2` plus tag 57 |
