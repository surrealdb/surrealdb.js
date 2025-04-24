import type Surreal from "@surrealdb/legacy";

export async function fetchVersion(surreal: Surreal): Promise<string> {
	return (await surreal.version()).replace(/^surrealdb-/, "");
}
