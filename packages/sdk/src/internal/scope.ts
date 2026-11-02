/**
 * The namespace, database and access method an endpoint names in its path, as in
 * `https://db.example.com/ns/app/db/main/rpc`, which SurrealDB 4.0 reads in place of the
 * `surreal-ns` and `surreal-db` headers and pins the connection's sessions to.
 */
export interface EndpointScope {
    /** The path before the scope and `/rpc`, without a trailing slash */
    base: string;
    /** The `/ns/{ns}[/db/{db}]` part of the path, which the scopable routes take, or empty */
    prefix: string;
    namespace?: string;
    database?: string;
    access?: string;
}

const SCOPE = /(?:\/ns\/([^/]+)(?:\/db\/([^/]+))?)?(?:\/ac\/([^/]+))?$/;

/**
 * The scope of an endpoint whose path ends in `/rpc`.
 */
export function endpointScope(url: URL): EndpointScope {
    const path = url.pathname.endsWith("/rpc") ? url.pathname.slice(0, -4) : url.pathname;
    const match = SCOPE.exec(path);

    // Unreachable, as every part of the pattern is optional
    if (!match) return { base: path, prefix: "" };

    const [scope, ns, db, ac] = match;
    const namespace = ns === undefined ? undefined : decodeURIComponent(ns);
    const database = db === undefined ? undefined : decodeURIComponent(db);

    return {
        base: path.slice(0, path.length - scope.length),
        prefix: ns === undefined ? "" : `/ns/${ns}${db === undefined ? "" : `/db/${db}`}`,
        namespace,
        database,
        access: ac === undefined ? undefined : decodeURIComponent(ac),
    };
}
