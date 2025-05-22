export type Channel = "alpha" | "beta" | "stable";

export function extractVersionChannel(version: string): Channel {
	if (version.includes("-alpha")) {
		return "alpha";
	}

	if (version.includes("-beta")) {
		return "beta";
	}

	return "stable";
}
