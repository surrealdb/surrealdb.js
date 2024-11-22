import type Surreal from "../../src";

export async function fetchVersion(surreal: Surreal): Promise<string> {
	return (await surreal.version()).replace(/^surrealdb-/, "");
}
