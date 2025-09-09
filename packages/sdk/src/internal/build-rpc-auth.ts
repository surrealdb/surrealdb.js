import { SurrealError } from "../errors";
import type { AnyAuth, ConnectionState } from "../types";

export function buildRpcAuth(state: ConnectionState, auth: AnyAuth): Record<string, unknown> {
    if ("key" in auth) {
        return {
            ns: auth.namespace,
            db: auth.database,
            ac: auth.access,
            key: auth.key,
        };
    }

    // Record user authentication
    if ("variables" in auth) {
        const namespace = auth.namespace ?? state.namespace;
        const database = auth.database ?? state.database;

        if (!database || !namespace) {
            throw new SurrealError(
                "Namespace and database must be provided or selected for record authentication",
            );
        }

        return {
            ...auth.variables,
            ac: auth.access,
            ns: namespace,
            db: database,
        };
    }

    // System authentication
    const access = "access" in auth ? auth.access : undefined;
    const namespace = "namespace" in auth ? auth.namespace : undefined;
    const database = "database" in auth ? auth.database : undefined;
    const result: Record<string, unknown> = {
        user: auth.username,
        pass: auth.password,
    };

    if (database && !namespace) {
        throw new SurrealError("Database authentication requires a namespace to be provided");
    }

    if (access) result.ac = access;
    if (namespace) result.ns = namespace;
    if (database) result.db = database;

    return result;
}
