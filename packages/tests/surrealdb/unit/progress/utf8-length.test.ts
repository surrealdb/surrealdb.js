import { expect, test } from "bun:test";
import { utf8Length } from "../../../../sdk/src/internal/progress";

// Spelled out rather than compared with TextEncoder, which some Bun releases get wrong for a
// trailing lone surrogate. A lone surrogate encodes as U+FFFD, in three bytes.
const SAMPLES: [string, number][] = [
    ["", 0],
    ["ascii", 5],
    ["café", 5],
    ["日本語", 9],
    ["emoji 🦀 here", 15],
    ["lone \ud800 high", 13],
    ["lone \udc00 low", 12],
    ["end \ud83e", 7],
];

test("the UTF-8 length of a string counts what it encodes to", () => {
    for (const [sample, length] of SAMPLES) {
        expect(utf8Length(sample)).toBe(length);
    }
});
