import type { Surreal } from "surrealdb";

export async function fetchVersion(surreal: Surreal): Promise<string> {
    const { version } = await surreal.version();
    return version.replace(/^surrealdb-/, "");
}
