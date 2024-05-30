import { NoDatabaseSpecified, NoNamespaceSpecified } from "../errors.ts";
import type { AnyAuth } from "../types.ts";
import { isNil } from "./isNil.ts";

export function processAuthVars<T extends AnyAuth>(vars: T, fallback?: {
	namespace?: string;
	database?: string;
}) {
	if ("scope" in vars) {
		if (!vars.namespace) vars.namespace = fallback?.namespace;
		if (!vars.database) vars.database = fallback?.database;
		if (isNil(vars.namespace)) {
			throw new NoNamespaceSpecified();
		}
		if (isNil(vars.database)) throw new NoDatabaseSpecified();
	}

	return vars;
}
