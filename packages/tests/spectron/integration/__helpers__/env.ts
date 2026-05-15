const base = process.env.SPECTRON_ENDPOINT ?? "";
const key = process.env.SPECTRON_API_KEY ?? "";

export const hasLiveSpectronEnv = Boolean(base && key);

export function requireEnv(): { endpoint: string; apiKey: string } {
    if (!hasLiveSpectronEnv) {
        throw new Error("SPECTRON_ENDPOINT and SPECTRON_API_KEY must be set for live tests");
    }
    return { endpoint: base.replace(/\/$/, ""), apiKey: key };
}
