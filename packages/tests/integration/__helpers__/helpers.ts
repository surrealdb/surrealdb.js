import type { AnySurreal } from "./surreal";

export async function fetchVersion(surreal: AnySurreal): Promise<string> {
	return (await surreal.version()).replace(/^surrealdb-/, "");
}
