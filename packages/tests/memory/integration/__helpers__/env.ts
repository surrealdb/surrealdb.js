const base = process.env.AGENT_MEMORY_ENDPOINT ?? "";
const key = process.env.AGENT_MEMORY_API_KEY ?? "";

export const hasLiveAgentMemoryEnv = Boolean(base && key);

export function requireEnv(): { endpoint: string; apiKey: string } {
    if (!hasLiveAgentMemoryEnv) {
        throw new Error(
            "AGENT_MEMORY_ENDPOINT and AGENT_MEMORY_API_KEY must be set for live tests",
        );
    }
    return { endpoint: base.replace(/\/$/, ""), apiKey: key };
}
