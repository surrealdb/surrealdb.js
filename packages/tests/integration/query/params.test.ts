import { describe, expect, test } from "bun:test";
import { createSurreal } from "../__helpers__";

describe("let() / unset()", async () => {
    const surreal = await createSurreal();

    test("define param", async () => {
        await surreal.set("hello", "world");

        const [result] = await surreal.query("RETURN $hello").collect<[string]>();

        expect(result).toBe("world");
    });

    test("unset param", async () => {
        await surreal.unset("hello");

        const [result] = await surreal.query("RETURN $hello").collect<[string]>();

        expect(result).toBeUndefined();
    });

    test("retrieve state", async () => {
        await surreal.set("foo", "bar");

        expect(surreal.parameters).toMatchObject({
            foo: "bar",
        });
    });
});
