import { describe, expect, test } from "bun:test";
import { createSurreal } from "../__helpers__";

describe("let() / unset()", async () => {
    test("define param", async () => {
        const surreal = await createSurreal();
        await surreal.set("hello", "world");

        const [result] = await surreal.query("RETURN $hello").collect<[string]>();

        expect(result).toBe("world");
    });

    test("unset param", async () => {
        const surreal = await createSurreal();
        await surreal.unset("hello");

        const [result] = await surreal.query("RETURN $hello").collect<[string]>();

        expect(result).toBeUndefined();
    });

    test("retrieve state", async () => {
        const surreal = await createSurreal();
        await surreal.set("foo", "bar");

        expect(surreal.parameters).toMatchObject({
            foo: "bar",
        });
    });
});
