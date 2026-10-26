import { barplot, bench, do_not_optimize, group, run, summary } from "mitata";
import { DateTime } from "../../value/datetime.ts";
import { RecordId } from "../../value/record-id.ts";
import { U8 } from "../../value/sized.ts";
import { CborCodec } from "../cbor/codec.ts";
import { BlockReader, ShapedBlock } from "./block.ts";
import { ShapedCodec } from "./codec.ts";
import { MAY_BE_ABSENT, NO_SLOT } from "./constants.ts";
import { Kind } from "./kinds.ts";

// Run with: bun run src/codec/shaped/shaped.bench.ts
//
// One statement's worth of rows, carried as a CBOR array of maps and as one shaped block, to
// compare what each costs the client. Note that only the decode side is a real client path:
// the SDK never writes a block, so the writer below exists to build the fixture, and its encode
// timing says nothing about what the server's writer costs.

const ROWS = 10_000;

/** A row of the schema below, as the SDK represents it */
interface Person {
    active: boolean;
    age: U8;
    created: DateTime;
    email: string;
    id: RecordId;
    name: string;
    nickname?: string;
    score: number;
}

/**
 * `SELECT * FROM person` over a schemafull table of eight fields, one of which is optional.
 * Columns are listed in the byte order of their names, as a shape requires, and the fixed
 * region packs the fixed kinds back to back: age@0, active@1, score@2, created@10.
 */
const SHAPE = {
    presenceBits: 1,
    fixedSize: 22,
    varCount: 4,
    columns: [
        { name: "active", kind: Kind.Bool, slot: 1 },
        { name: "age", kind: Kind.U8, slot: 0 },
        { name: "created", kind: Kind.Datetime, slot: 10 },
        { name: "email", kind: Kind.String, slot: 2 },
        { name: "id", kind: Kind.Record, slot: 0, table: "person" },
        { name: "name", kind: Kind.String, slot: 1 },
        { name: "nickname", kind: Kind.String, slot: 3, flags: MAY_BE_ABSENT, presence: 0 },
        { name: "score", kind: Kind.Float, slot: 2 },
    ],
};

const people: Person[] = Array.from({ length: ROWS }, (_, i) => ({
    active: i % 3 !== 0,
    age: new U8(18 + (i % 60)),
    created: new DateTime([BigInt(1_700_000_000 + i), BigInt((i * 7919) % 1_000_000_000)]),
    email: `person${i}@example.com`,
    id: new RecordId("person", i),
    name: `Person Number ${i}`,
    // Half the rows do not hold the key at all, which is what its presence bit says
    ...(i % 2 === 0 ? { nickname: `p${i}` } : {}),
    score: (i % 1000) / 7,
}));

// --- a block writer, for the fixture only ---------------------------------------------------

class Bytes {
    #parts: number[] = [];

    u8(v: number): this {
        this.#parts.push(v & 0xff);
        return this;
    }

    u16(v: number): this {
        return this.u8(v).u8(v >>> 8);
    }

    u32(v: number): this {
        return this.u16(v & 0xffff).u16(v >>> 16);
    }

    raw(bytes: Uint8Array | number[]): this {
        for (const b of bytes) this.#parts.push(b & 0xff);
        return this;
    }

    get bytes(): Uint8Array {
        return new Uint8Array(this.#parts);
    }
}

const utf8 = (value: string) => new TextEncoder().encode(value);

/** The SHAPE payload of the schema above, past its shape id */
function shapePayload(): Uint8Array {
    const out = new Bytes()
        .u8(0)
        .u32(SHAPE.presenceBits)
        .u32(SHAPE.fixedSize)
        .u32(SHAPE.varCount)
        .u32(NO_SLOT)
        .u32(SHAPE.columns.length);

    for (const column of SHAPE.columns) {
        const name = utf8(column.name);
        const table = utf8(column.table ?? "");

        out.u16(name.length)
            .raw(name)
            .u8(column.kind)
            .u8(0)
            .u8(column.flags ?? 0)
            .u32(column.presence ?? NO_SLOT)
            .u32(column.slot)
            .u16(table.length)
            .raw(table)
            .u32(0)
            .u32(NO_SLOT);
    }

    return out.bytes;
}

/** One row: its presence byte, its fixed region, its ends table and its var slices */
function writeRow(person: Person): Uint8Array {
    const fixed = new Uint8Array(SHAPE.fixedSize);
    const view = new DataView(fixed.buffer);
    const [secs, nanos] = person.created.toCompact();

    view.setUint8(0, person.age.value);
    view.setUint8(1, person.active ? 1 : 0);
    view.setFloat64(2, person.score, true);
    view.setBigInt64(10, secs, true);
    view.setUint32(18, Number(nanos), true);

    // A record slice whose column names the table: the key kind byte, then the i64 id
    const key = new Uint8Array(8);
    new DataView(key.buffer).setBigInt64(0, BigInt(person.id.id as number), true);
    const id = new Bytes().u8(0).raw(key);

    const slices = [
        id.bytes,
        utf8(person.name),
        utf8(person.email),
        person.nickname === undefined ? new Uint8Array(0) : utf8(person.nickname),
    ];

    const out = new Bytes().u8(person.nickname === undefined ? 0 : 1).raw(fixed);

    let end = 0;
    for (const slice of slices) {
        end += slice.length;
        out.u32(end);
    }
    for (const slice of slices) out.raw(slice);

    return out.bytes;
}

/** A block of every row: one SHAPE message, then one BATCH */
function writeBlock(rows: Person[]): Uint8Array {
    const shape = new Bytes().u32(1).raw(shapePayload()).bytes;
    const batch = new Bytes().u32(1).u32(rows.length);
    for (const person of rows) batch.raw(writeRow(person));

    const payload = batch.bytes;
    return new Bytes()
        .u8(1)
        .u8(0x01)
        .u32(shape.length)
        .raw(shape)
        .u8(0x02)
        .u32(payload.length)
        .raw(payload).bytes;
}

// --- the fixtures ----------------------------------------------------------------------------

const cbor = new CborCodec({});
const cbor2 = new CborCodec({ version: 2 });
const shaped = new ShapedCodec({});

const cborBytes = cbor.encode(people);
const cbor2Bytes = cbor2.encode(people);
const blockBytes = writeBlock(people);

// A benchmark of a decode which does not produce the right rows measures nothing, so the two
// paths are checked against each other before either is timed
function checkParity(): void {
    const viaCbor = cbor2.decode<Person[]>(cbor2Bytes);
    const viaShaped = new BlockReader().read(
        new ShapedBlock(blockBytes),
        shaped.dynamic,
    ) as Person[];

    if (viaShaped.length !== viaCbor.length) {
        throw new Error(`shaped read ${viaShaped.length} rows, cbor.2 read ${viaCbor.length}`);
    }

    for (let i = 0; i < viaCbor.length; i++) {
        const a = viaCbor[i] as Person;
        const b = viaShaped[i] as Person;
        const same =
            a.active === b.active &&
            a.age.value === b.age.value &&
            a.created.toString() === b.created.toString() &&
            a.email === b.email &&
            a.id.toString() === b.id.toString() &&
            a.name === b.name &&
            a.nickname === b.nickname &&
            a.score === b.score;

        if (!same) {
            throw new Error(
                `row ${i} differs:\n  cbor.2 ${JSON.stringify(a)}\n  shaped ${JSON.stringify(b)}`,
            );
        }
    }
}

checkParity();

const per = (bytes: Uint8Array) => (bytes.length / ROWS).toFixed(1);

console.log(`${ROWS} rows of ${SHAPE.columns.length} fields\n`);
console.log(`  cbor    ${cborBytes.length} bytes  (${per(cborBytes)} per row)`);
console.log(`  cbor.2  ${cbor2Bytes.length} bytes  (${per(cbor2Bytes)} per row)`);
console.log(`  shaped  ${blockBytes.length} bytes  (${per(blockBytes)} per row)`);
console.log(
    `  shaped is ${((1 - blockBytes.length / cbor2Bytes.length) * 100).toFixed(1)}% smaller than cbor.2\n`,
);

// A decode must not be able to reuse a scope's shapes between runs, so each one starts fresh
const block = new ShapedBlock(blockBytes.subarray(0));

group("decode a statement's rows", () => {
    barplot(() => {
        summary(() => {
            bench("cbor", () => do_not_optimize(cbor.decode(cborBytes)));
            bench("cbor.2", () => do_not_optimize(cbor2.decode(cbor2Bytes)));
            bench("shaped", () => do_not_optimize(new BlockReader().read(block, shaped.dynamic)));
        });
    });
});

group("encode a statement's rows", () => {
    barplot(() => {
        summary(() => {
            bench("cbor", () => do_not_optimize(cbor.encode(people)));
            bench("cbor.2", () => do_not_optimize(cbor2.encode(people)));
            // Not a client path: the server writes blocks, and its writer copies runs of stored
            // bytes rather than building each row from values as this one does
            bench("shaped (fixture writer)", () => do_not_optimize(writeBlock(people)));
        });
    });
});

await run();
