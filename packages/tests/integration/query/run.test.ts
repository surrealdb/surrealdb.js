import { describe, expect, test } from "bun:test";
import { createSurreal, proto } from "../__helpers__";

describe("run()", async () => {
    test("run", async () => {
        const surreal = await createSurreal();
        const res = await surreal.run<number[]>("array::add", [[1, 2], 3]);
        expect(res).toMatchObject([1, 2, 3]);
    });

    test("compile", async () => {
        const surreal = await createSurreal();
        const builder = surreal.run<number[]>("array::add", [[1, 2], 3]);
        const { query, bindings } = builder.compile();

        expect(query).toMatchSnapshot(proto("query"));
        expect(bindings).toMatchSnapshot(proto("bindings"));
    });
});
