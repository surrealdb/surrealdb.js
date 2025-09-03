import { beforeEach, describe, expect, test } from "bun:test";
import { resetIncrementalID } from "../../../sdk/src/internal/get-incremental-id";
import { setupServer } from "../__helpers__";

const { createSurreal } = await setupServer();

beforeEach(async () => {
    resetIncrementalID();
});

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
