const base = process.env.SPECTRON_BASE_URL ?? "";
const key = process.env.SPECTRON_API_KEY ?? "";

export const hasLiveSpectronEnv = Boolean(base && key);

export function requireEnv(): { baseUrl: string; apiKey: string } {
    if (!hasLiveSpectronEnv) {
        throw new Error("SPECTRON_BASE_URL and SPECTRON_API_KEY must be set for live tests");
    }
    return { baseUrl: base.replace(/\/$/, ""), apiKey: key };
}
