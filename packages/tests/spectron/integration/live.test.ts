import { describe, expect, test } from "bun:test";
import { Spectron } from "@surrealdb/spectron";
import { hasLiveSpectronEnv, requireEnv } from "./__helpers__/env.js";

describe("Spectron live", () => {
    test.skipIf(!hasLiveSpectronEnv)("health check", async () => {
        const { baseUrl, apiKey } = requireEnv();
        const s = new Spectron({ context: "default", apiKey, baseUrl });
        await s.health();
        expect(s.contextId).toBe("default");
    });
});
