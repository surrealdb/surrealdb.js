import { describe, expect, test } from "bun:test";
import { AlreadyExistsError, NotFoundError } from "../../../../sdk/src";
import { ImportReportReader } from "../../../../sdk/src/internal/import-report";

const encoder = new TextEncoder();

function failure(message: string, extra: Record<string, unknown> = {}) {
    return { status: "ERR", time: "1µs", result: message, ...extra };
}

/** Read a report handed over in pieces of the given number of bytes */
function read(text: string, size = Number.POSITIVE_INFINITY) {
    const bytes = encoder.encode(text);
    const reader = new ImportReportReader();

    for (let offset = 0; offset < bytes.length; offset += size) {
        reader.push(bytes.subarray(offset, offset + size));
    }

    return reader.finish();
}

describe("an import report", () => {
    test("an empty list reports nothing", () => {
        expect(read("[]")).toMatchObject({ failed: 0, failures: [], truncated: false });
    });

    test("the failures are read from the 3.x shape, with their kinds", () => {
        const report = read(
            JSON.stringify([
                failure("Database record `a:1` already exists", {
                    kind: "AlreadyExists",
                    details: { kind: "Record", details: { id: "a:1" } },
                }),
                failure("The namespace 'x' does not exist", {
                    kind: "NotFound",
                    details: { kind: "Namespace", details: { name: "x" } },
                }),
            ]),
        );

        expect(report.failed).toBe(2);
        expect(report.truncated).toBe(false);
        expect(report.failures[0]).toBeInstanceOf(AlreadyExistsError);
        expect(report.failures[0]?.message).toBe("Database record `a:1` already exists");
        expect(report.failures[1]).toBeInstanceOf(NotFoundError);
    });

    test("results which applied are passed over", () => {
        const report = read(
            JSON.stringify([
                { status: "OK", time: "1µs", result: [{ id: "a:1" }] },
                failure("Database record `a:1` already exists"),
                { status: "OK", time: "1µs", result: [{ id: "a:2", note: "]}{[" }] },
            ]),
        );

        expect(report.failed).toBe(1);
        expect(report.failures.map((error) => error.message)).toEqual([
            "Database record `a:1` already exists",
        ]);
    });

    test("however it is split, brackets, braces and quotes in strings are read as text", () => {
        const text = JSON.stringify([
            failure('Parse error: unexpected `]` in "CREATE a:[1, {b: \\"}\\"}]"'),
            failure("emoji 🦀 and ünïcödé"),
            failure("trailing backslash \\"),
        ]);

        for (const size of [1, 2, 3, 7, 64]) {
            const report = read(text, size);

            expect(report.failed).toBe(3);
            expect(report.failures.map((error) => error.message)).toEqual([
                'Parse error: unexpected `]` in "CREATE a:[1, {b: \\"}\\"}]"',
                "emoji 🦀 and ünïcödé",
                "trailing backslash \\",
            ]);
        }
    });

    test("the first hundred failures are kept, and every one is counted", () => {
        const report = read(
            JSON.stringify(Array.from({ length: 250 }, (_, i) => failure(`failure ${i}`))),
            100,
        );

        expect(report.failed).toBe(250);
        expect(report.failures).toHaveLength(100);
        expect(report.failures[99]?.message).toBe("failure 99");
    });

    test("a list which is cut short is reported as incomplete, with what was read", () => {
        const text = JSON.stringify([failure("first"), failure("second")]);
        const report = read(text.slice(0, text.indexOf("second") - 5));

        expect(report).toMatchObject({ failed: 1, truncated: true });
    });

    test("a body which is not a list reports nothing, and keeps its start", () => {
        const report = read("Internal Server Error");

        expect(report).toMatchObject({ failed: 0, truncated: true, head: "Internal Server Error" });
    });
});
