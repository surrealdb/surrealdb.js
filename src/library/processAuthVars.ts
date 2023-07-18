import { AnyAuth } from "../types.ts";
import { isNil } from "./isNil.ts";

export function processAuthVars<T extends AnyAuth>(vars: T, fallback?: {
	namespace?: string;
	database?: string;
}) {
	if ("SC" in vars) {
		if (!vars.NS) vars.NS = fallback?.namespace;
		if (!vars.DB) vars.DB = fallback?.database;
		if (isNil(vars.NS)) throw new Error("No namespace was specified!");
		if (isNil(vars.DB)) throw new Error("No database was specified!");
	}

	return vars;
}
