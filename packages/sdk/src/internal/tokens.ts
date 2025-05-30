export function fastParseJwt(token: string) {
	try {
		const parts = token.split(".");

		if (parts.length !== 3) {
			return null;
		}

		return JSON.parse(atob(parts[1]));
	} catch {
		return null;
	}
}
