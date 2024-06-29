import { NoDatabaseSpecified, NoNamespaceSpecified } from "../errors.ts";
import type { AnyAuth } from "../types.ts";

export function processAuthVars<T extends AnyAuth>(
	vars: T,
	fallback?: {
		namespace?: string;
		database?: string;
	},
) {
	if ("scope" in vars || "access" in vars) {
		if (!vars.namespace) {
			if (!fallback?.namespace) throw new NoNamespaceSpecified();
			vars.namespace = fallback.namespace;
		}

		if (!vars.database) {
			if (!fallback?.database) throw new NoDatabaseSpecified();
			vars.database = fallback.database;
		}
	}

	return vars;
}
