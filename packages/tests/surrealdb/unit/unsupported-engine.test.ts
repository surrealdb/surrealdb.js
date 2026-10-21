import { describe, expect, test } from "bun:test";
import { Surreal, UnsupportedEngineError } from "../../../sdk/src";

describe("unsupported engine errors", () => {
    test("a persistent store with no engine names the package that provides it", async () => {
        const db = new Surreal({ engines: {} });

        for (const url of ["surrealkv://app", "indxdb://app"]) {
            const error = await db.connect(url).then(
                () => undefined,
                (caught: unknown) => caught,
            );

            expect(error).toBeInstanceOf(UnsupportedEngineError);
            expect((error as UnsupportedEngineError).engine).toBe(url.split(":")[0]);
            expect((error as UnsupportedEngineError).message).toContain("createWasmWorkerEngines");
        }
    });

    test("surrealkv also names the Node.js package", async () => {
        const db = new Surreal({ engines: {} });

        const error = await db.connect("surrealkv://app").then(
            () => undefined,
            (caught: unknown) => caught,
        );

        expect((error as UnsupportedEngineError).message).toContain("@surrealdb/node");
    });

    test("an unknown scheme keeps the plain message", async () => {
        const db = new Surreal({ engines: {} });

        const error = await db.connect("unknownstore://app").then(
            () => undefined,
            (caught: unknown) => caught,
        );

        expect(error).toBeInstanceOf(UnsupportedEngineError);
        expect((error as UnsupportedEngineError).message).toBe(
            'The engine "unknownstore" is not supported or configured',
        );
    });
});
