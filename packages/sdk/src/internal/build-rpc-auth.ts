import { MissingNamespaceDatabaseError } from "../errors";
import type { AnyAuth, ConnectionSession } from "../types";

export function buildRpcAuth(session: ConnectionSession, auth: AnyAuth): Record<string, unknown> {
    if ("key" in auth) {
        if (auth.database && !auth.namespace) {
            throw new MissingNamespaceDatabaseError();
        }

        const result: Record<string, unknown> = {
            ac: auth.access,
            key: auth.key,
        };

        if (auth.namespace) result.ns = auth.namespace;
        if (auth.database) result.db = auth.database;

        return result;
    }

    // Record user authentication
    if ("variables" in auth) {
        const namespace = auth.namespace ?? session.namespace;
        const database = auth.database ?? session.database;

        if (!database || !namespace) {
            throw new MissingNamespaceDatabaseError();
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
        throw new MissingNamespaceDatabaseError();
    }

    if (access) result.ac = access;
    if (namespace) result.ns = namespace;
    if (database) result.db = database;

    return result;
}
