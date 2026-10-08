import { describe, expect, test } from "bun:test";
import { engineVersion } from "../../../node/dist/surrealdb-node";
import nodePackage from "../../../node/package.json";
import { SURREAL_BACKEND } from "./__helpers__/env";

describe.if(SURREAL_BACKEND === "node")("engineVersion()", () => {
    test("reports the engine this repo is tested against", () => {
        const pinned = nodePackage.devDependencies["@surrealdb/node-native"];
        expect(engineVersion()).toBe(pinned);
    });
});
