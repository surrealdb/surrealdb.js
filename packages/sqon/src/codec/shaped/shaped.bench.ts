import { barplot, bench, do_not_optimize, group, run, summary } from "mitata";
import { DateTime } from "../../value/datetime.ts";
import { RecordId } from "../../value/record-id.ts";
import { U8 } from "../../value/sized.ts";
import { CborCodec } from "../cbor/codec.ts";
import { BlockReader, ShapedBlock } from "./block.ts";
import { ShapedCodec } from "./codec.ts";
import { deriveShape } from "./derive.ts";
import { writeBlock } from "./write.ts";

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

// --- the fixtures ----------------------------------------------------------------------------

const cbor = new CborCodec({});
const cbor2 = new CborCodec({ version: 2 });
const shaped = new ShapedCodec({});

const cborBytes = cbor.encode(people);
const cbor2Bytes = cbor2.encode(people);
const derived = deriveShape(people);
if (!derived) throw new Error("the rows have no shape");
const blockBytes = writeBlock(derived, people, (v) => cbor2.encode(v));

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

console.log(`${ROWS} rows of 8 fields\n`);
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
            // What the SDK does when it sends a long array: derive a shape, write the rows in
            // it, and measure the result against the CBOR array before keeping it
            bench("shaped (derive + write)", () => do_not_optimize(shaped.block(people)));
            // The same write with the shape already in hand, which is what the comparison above
            // costs on top
            bench("shaped (write only)", () =>
                do_not_optimize(writeBlock(derived, people, (v) => cbor2.encode(v))),
            );
        });
    });
});

await run();
