import { SurrealError } from "../errors";
import type { AnyAuth } from "../types";

function convertString(
	auth: AnyAuth,
	result: Record<string, unknown>,
	from: string,
	to: string,
	optional?: boolean,
) {
	if (from in auth) {
		result[to] = `${auth[from as keyof AnyAuth]}`;
		delete result[from];
	} else if (optional !== true) {
		throw new SurrealError(
			`Key ${from} is missing from the authentication parameters`,
		);
	}
}

export function convertAuth(auth: AnyAuth): Record<string, unknown> {
	let result: Record<string, unknown> = {};

	if ("variables" in auth) {
		result = { ...auth.variables };
		convertString(auth, result, "access", "ac");
		convertString(auth, result, "namespace", "ns");
		convertString(auth, result, "database", "db");
	} else {
		convertString(auth, result, "access", "ac", true);
		convertString(auth, result, "database", "db", true);
		convertString(auth, result, "namespace", "ns", !("database" in auth));
		convertString(auth, result, "username", "user");
		convertString(auth, result, "password", "pass");
	}

	return result;
}
