import { describe, expect, test } from "bun:test";
import { createSurreal } from "../__helpers__";

describe("run()", async () => {
    const surreal = await createSurreal();

    test("run", async () => {
        const res = await surreal.run<number[]>("array::add", [[1, 2], 3]);
        expect(res).toMatchObject([1, 2, 3]);
    });

    test("compile", async () => {
        const builder = surreal.run<number[]>("array::add", [[1, 2], 3]);
        const { query, bindings } = builder.compile();

        expect(query).toMatchSnapshot();
        expect(bindings).toMatchSnapshot();
    });
});
