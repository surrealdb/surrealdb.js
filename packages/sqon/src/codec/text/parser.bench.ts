import { barplot, bench, do_not_optimize, group, run, summary } from "mitata";
import { parseText } from "./parser.ts";

// Run with: bun run src/codec/text/parser.bench.ts

const benchParse = (input: string) => () => do_not_optimize(parseText(input));

group("primitives", () => {
    summary(() => {
        bench("int", benchParse("42"));
        bench("bigint", benchParse("9007199254740993"));
        bench("float", benchParse("3.14159265358979"));
        bench("decimal", benchParse("3.14159265358979dec"));
        bench("bool", benchParse("true"));
        bench("null", benchParse("NULL"));
        bench("none", benchParse("NONE"));
        bench("short string", benchParse("'hello'"));
        bench("long string", benchParse(`'${"lorem ipsum dolor sit amet ".repeat(20)}'`));
        bench("string with escapes", benchParse("'tab\\t newline\\n quote\\' unicode\\u0041'"));
    });
});

group("surrealdb scalars", () => {
    summary(() => {
        bench("duration (single unit)", benchParse("100ms"));
        bench("duration (multi unit)", benchParse("1y2w3d4h5m6s7ms8us9ns"));
        bench("datetime", benchParse('d"2024-01-15T09:30:00.123456789Z"'));
        bench("uuid", benchParse('u"01924b3c-f1a2-7e3d-a001-2f4b8c9d0e1f"'));
        bench("bytes", benchParse('b"48656C6C6F20576F726C64"'));
        bench("file", benchParse('f"bucket:/path/to/file.txt"'));
    });
});

group("tables & record ids", () => {
    summary(() => {
        bench("table", benchParse("person"));
        bench("record id (string)", benchParse("user:tobie"));
        bench("record id (numeric)", benchParse("user:42"));
        bench("record id (uuid)", benchParse('user:u"01924b3c-f1a2-7e3d-a001-2f4b8c9d0e1f"'));
        bench("record id (object)", benchParse("user:{ name: 'john', age: 30 }"));
        bench("record id (array)", benchParse("temperature:['London', 2022]"));
        bench("record id (backtick)", benchParse("`my table`:`the id`"));
        bench("record id range", benchParse("user:1..=1000"));
    });
});

group("ranges", () => {
    summary(() => {
        bench("numeric range", benchParse("0..1000"));
        bench("inclusive range", benchParse("0..=1000"));
        bench("exclusive-start range", benchParse("0>..1000"));
        bench("unbounded range", benchParse(".."));
        bench("string range", benchParse("'a'..'z'"));
    });
});

group("collections", () => {
    summary(() => {
        bench("empty array", benchParse("[]"));
        bench("empty object", benchParse("{}"));
        bench("small array", benchParse("[1, 2, 3, 4, 5]"));
        bench(
            "large array (100 ints)",
            benchParse(`[${Array.from({ length: 100 }, (_, i) => i).join(", ")}]`),
        );
        bench("small object", benchParse("{ name: 'Jane', age: 30, active: true }"));
        bench("set", benchParse("{ 1, 2, 3, 4, 5 }"));
        bench("nested", benchParse("{ list: [1, { deep: [true, false] }], flag: NONE }"));
    });
});

const DOCUMENT = `{
    id: user:⟨01924b3c-f1a2-7e3d-a001-2f4b8c9d0e1f⟩,
    name: 'Jane Doe',
    age: 30,
    verified: true,
    score: 4.75,
    balance: 1234.56dec,
    created_at: d"2024-01-15T09:30:00.123456789Z",
    session: 2w3d,
    tags: ['admin', 'beta', 'early-adopter'],
    ratings: { 1, 2, 3, 4, 5 },
    location: (-122.4194, 37.7749),
    friends: [user:tobie, user:alice, user:bob],
    active_range: user:1..=100,
    metadata: { nested: { deeply: { value: NULL } } }
}`;

group("documents", () => {
    barplot(() => {
        bench("realistic document", benchParse(DOCUMENT));
        bench("deeply nested array", benchParse("[".repeat(50) + "1" + "]".repeat(50)));
    });
});

await run();
