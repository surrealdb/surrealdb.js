import type { Surreal } from "surrealdb";

export async function fetchVersion(surreal: Surreal): Promise<string> {
	return (await surreal.version()).replace(/^surrealdb-/, "");
}
