import { describe, expect, test } from "bun:test";
import { Surreal, UnsupportedEngineError } from "surrealdb";
import { SURREAL_BACKEND } from "./__helpers__";

// The wasm package is only built for the wasm backend, so it is loaded inside each
// test rather than at module load. Other backends would otherwise fail to load this file.
const loadWasmEngines = () => import("../../../wasm/dist/surrealdb-wasm");

describe("wasm engine registration", () => {
    test.if(SURREAL_BACKEND === "wasm")("main thread engines offer mem only", async () => {
        const { createWasmEngines } = await loadWasmEngines();

        expect(Object.keys(createWasmEngines()).sort()).toEqual(["mem"]);
    });

    test.if(SURREAL_BACKEND === "wasm")(
        "worker engines offer mem, surrealkv and indxdb",
        async () => {
            const { createWasmWorkerEngines } = await loadWasmEngines();
            const engines = createWasmWorkerEngines();

            expect(Object.keys(engines).sort()).toEqual(["indxdb", "mem", "surrealkv"]);
        },
    );

    test.if(SURREAL_BACKEND === "wasm")(
        "indxdb is a pass-through to the same worker engine as surrealkv",
        async () => {
            const { createWasmWorkerEngines } = await loadWasmEngines();
            const engines = createWasmWorkerEngines();

            expect(engines.indxdb).toBe(engines.surrealkv);
        },
    );

    test.if(SURREAL_BACKEND === "wasm")(
        "main thread engines reject persistent browser stores",
        async () => {
            const { createWasmEngines } = await loadWasmEngines();

            for (const url of ["surrealkv://test.db", "indxdb://test"]) {
                const db = new Surreal({ engines: createWasmEngines() });

                const error = await db.connect(url).catch((caught: unknown) => caught);

                expect(error).toBeInstanceOf(UnsupportedEngineError);
                expect((error as Error).message).toContain("createWasmWorkerEngines");
                expect(db.status).toBe("disconnected");
            }
        },
    );
});
