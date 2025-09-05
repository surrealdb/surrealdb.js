import { describe, expect, test } from "bun:test";
import { FileRef } from "surrealdb";

describe("File", () => {
    test("formatting", () => {
        const file = new FileRef("hello world", "/foo bar/test.json");

        expect(file.toString()).toBe("hello\\ world:/foo\\ bar/test.json");
    });
});
