import { describe, expect, test } from "bun:test";
import { Table } from "surrealdb";

describe("Table", () => {
    test("construct from string", () => {
        const table = new Table("users");
        expect(table.name).toBe("users");
    });

    test("rejects non-string", () => {
        // @ts-expect-error
        expect(() => new Table(123)).toThrow();
    });

    test("toString escapes identifiers", () => {
        expect(new Table("users").toString()).toBe("users");
        expect(new Table("complex-table").toString()).toBe("⟨complex-table⟩");
    });

    test("equals", () => {
        const a = new Table("users");
        const b = new Table("users");
        const c = new Table("posts");
        expect(a.equals(b)).toBe(true);
        expect(a.equals(c)).toBe(false);
        expect(a.equals("users")).toBe(false);
    });

    test("name getter returns unescaped name", () => {
        const table = new Table("complex-table");
        expect(table.name).toBe("complex-table");
    });
});
