import { expect, test } from "bun:test";
import { utf8Length } from "../../../../sdk/src/internal/progress";

test("the UTF-8 length of a string matches what TextEncoder produces", () => {
    const encoder = new TextEncoder();
    const samples = [
        "",
        "ascii",
        "café",
        "日本語",
        "emoji 🦀 here",
        "lone \ud800 high",
        "lone \udc00 low",
        "end \ud83e",
    ];

    for (const sample of samples) {
        expect(utf8Length(sample)).toBe(encoder.encode(sample).byteLength);
    }
});
