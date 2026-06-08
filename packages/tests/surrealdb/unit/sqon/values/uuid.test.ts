import { describe, expect, test } from "bun:test";
import { Uuid } from "surrealdb";

describe("Uuid", () => {
    const EXAMPLE = "d2f72714-a387-487a-8eae-451330796ff4";

    test("construct from string", () => {
        const uuid = new Uuid(EXAMPLE);
        expect(uuid.toString()).toBe(EXAMPLE);
    });

    test("construct from Uint8Array", () => {
        const original = new Uuid(EXAMPLE);
        const bytes = original.toUint8Array();
        const restored = new Uuid(bytes);
        expect(restored.toString()).toBe(EXAMPLE);
    });

    test("construct from ArrayBuffer", () => {
        const original = new Uuid(EXAMPLE);
        const buffer = original.toBuffer();
        const restored = new Uuid(buffer);
        expect(restored.toString()).toBe(EXAMPLE);
    });

    test("clone from Uuid", () => {
        const original = new Uuid(EXAMPLE);
        const cloned = new Uuid(original);
        expect(cloned.toString()).toBe(EXAMPLE);
        expect(cloned.equals(original)).toBe(true);
    });

    test("equals", () => {
        const a = new Uuid(EXAMPLE);
        const b = new Uuid(EXAMPLE);
        expect(a.equals(b)).toBe(true);
        expect(a.equals(new Uuid(Uuid.v4()))).toBe(false);
        expect(a.equals("not a uuid")).toBe(false);
    });

    test("v4 generates valid uuid", () => {
        const uuid = Uuid.v4();
        expect(uuid).toBeInstanceOf(Uuid);
        expect(uuid.toString()).toMatch(
            /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
        );
    });

    test("v7 generates valid uuid", () => {
        const uuid = Uuid.v7();
        expect(uuid).toBeInstanceOf(Uuid);
        expect(uuid.toString()).toMatch(
            /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
        );
    });

    test("toUint8Array returns 16 bytes", () => {
        const uuid = new Uuid(EXAMPLE);
        const bytes = uuid.toUint8Array();
        expect(bytes).toBeInstanceOf(Uint8Array);
        expect(bytes.length).toBe(16);
    });
});
