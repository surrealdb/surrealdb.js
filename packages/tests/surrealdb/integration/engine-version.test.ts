import { describe, expect, test } from "bun:test";
import nodePackage from "../../../node/package.json";
import { SURREAL_BACKEND } from "./__helpers__/env";

describe.if(SURREAL_BACKEND === "node")("engineVersion()", () => {
    test("reports the engine this repo is tested against", async () => {
        // Imported lazily: the Node build only exists in the Node test job
        const { engineVersion } = await import("../../../node/dist/surrealdb-node");
        const pinned = nodePackage.devDependencies["@surrealdb/node-native"];
        expect(engineVersion()).toBe(pinned);
    });
});
