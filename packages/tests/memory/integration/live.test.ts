import { describe, expect, test } from "bun:test";
import { AgentMemory } from "@surrealdb/memory";
import { hasLiveAgentMemoryEnv, requireEnv } from "./__helpers__/env.js";

describe("Agent Memory live", () => {
    test.skipIf(!hasLiveAgentMemoryEnv)("health check", async () => {
        const { endpoint, apiKey } = requireEnv();
        const s = new AgentMemory({ context: "default", apiKey, endpoint });
        await s.health();
        expect(s.contextId).toBe("default");
    });
});
