import { afterEach, describe, expect, test } from "bun:test";
import { Surreal } from "surrealdb";
import { createJwtExpiringIn, createMockFetch, type MockHandler } from "./__helpers__/mock-fetch";

let open: Surreal | undefined;

afterEach(async () => {
    await open?.close();
    open = undefined;
});

const serving: MockHandler = (request) => {
    if (request.rpc?.method === "signin") return { result: createJwtExpiringIn(3600) };
    if (request.rpc?.method === "pgsql" || request.rpc?.method === "mysql") {
        return { result: { statements: [], transaction: { status: "idle" } } };
    }
    if (request.rpc) return { result: null };
    return { status: 200 };
};

async function connect(url: string, version = "surrealdb-4.0.0") {
    const server = createMockFetch(serving, version);
    const db = new Surreal({ fetchImpl: server.fetchImpl });
    open = db;

    await db.connect(url, {
        authentication: { username: "root", password: "root" },
    });

    return { db, server };
}

const pathOf = (url: string | undefined) => new URL(url ?? "").pathname;

describe("an endpoint scoped by its path (SurrealDB 4.0)", () => {
    test("starts its sessions in the namespace and database it names", async () => {
        const { db } = await connect("http://localhost:8000/ns/app/db/main/rpc");

        expect(db.namespace).toBe("app");
        expect(db.database).toBe("main");
    });

    test("decodes the names it carries", async () => {
        const { db } = await connect("http://localhost:8000/ns/a%2Fb/db/my%20db/rpc");

        expect(db.namespace).toBe("a/b");
        expect(db.database).toBe("my db");
    });

    test("keeps a name whose escape is malformed as it is", async () => {
        const { db } = await connect("http://localhost:8000/ns/100%/db/main/rpc");

        expect(db.namespace).toBe("100%");
    });

    test("prefers the namespace and database given to connect()", async () => {
        const server = createMockFetch(serving);
        const db = new Surreal({ fetchImpl: server.fetchImpl });
        open = db;
        await db.connect("http://localhost:8000/ns/app/db/main/rpc", {
            versionCheck: false,
            namespace: "app",
            database: "other",
        });

        expect(db.database).toBe("other");
    });

    test("returns to its scope on reset()", async () => {
        const { db } = await connect("http://localhost:8000/ns/app/db/main/rpc");

        await db.use({ namespace: "app", database: "other" });
        await db.reset();

        expect(db.namespace).toBe("app");
        expect(db.database).toBe("main");
    });

    test("asks /health without the scope, which the route does not take", async () => {
        const { db, server } = await connect("http://localhost:8000/proxy/ns/app/db/main/rpc");

        await db.health();

        const request = server.calls.find((call) => !call.rpc);
        expect(pathOf(request?.url)).toBe("/proxy/health");
    });

    test("calls an API on its unscoped route", async () => {
        const { db, server } = await connect("http://localhost:8000/ns/app/db/main/rpc");

        // The mock answers without a body, which is all the same for where it went
        await Promise.resolve(db.api().get("/hello")).catch(() => {});

        const request = server.calls.find((call) => !call.rpc);
        expect(pathOf(request?.url)).toBe("/api/app/main/hello");
    });

    test("imports on the scoped route, leaving out an access method", async () => {
        const { db, server } = await connect("http://localhost:8000/ns/app/db/main/ac/users/rpc");

        await db.import("RETURN 1;");

        const request = server.calls.find((call) => !call.rpc);
        expect(pathOf(request?.url)).toBe("/ns/app/db/main/import");
    });
});

describe("pgsql() and mysql()", () => {
    test("send the statements, then variables and options only when given", async () => {
        const { db, server } = await connect("http://localhost:8000/ns/app/db/main/rpc");

        await db.pgsql("SELECT 1");
        await db.pgsql("SELECT $1", { _1: 5 });
        await db.mysql(["SELECT ?", { text: "SELECT 2" }], undefined, { rowMode: "array" });

        const sent = server.calls
            .filter((call) => call.rpc?.method === "pgsql" || call.rpc?.method === "mysql")
            .map((call) => [call.rpc?.method, call.rpc?.params]);

        expect(sent).toEqual([
            ["pgsql", ["SELECT 1"]],
            ["pgsql", ["SELECT $1", { _1: 5 }]],
            ["mysql", [["SELECT ?", { text: "SELECT 2" }], null, { rowMode: "array" }]],
        ]);
    });

    test("send the session's variables over HTTP, under those of the call", async () => {
        const { db, server } = await connect("http://localhost:8000/ns/app/db/main/rpc");

        await db.set("who", "session");
        await db.set("limit", 1);
        await db.pgsql("SELECT $who");
        await db.mysql("SELECT ?", { _1: 2, limit: 5 }, { rowMode: "array" });

        const sent = server.calls
            .filter((call) => call.rpc?.method === "pgsql" || call.rpc?.method === "mysql")
            .map((call) => call.rpc?.params);

        expect(sent).toEqual([
            ["SELECT $who", { who: "session", limit: 1 }],
            ["SELECT ?", { who: "session", limit: 5, _1: 2 }, { rowMode: "array" }],
        ]);
    });

    test("are refused by a server before 4.0", async () => {
        const { db } = await connect("http://localhost:8000/ns/app/db/main/rpc", "surrealdb-3.3.4");

        await expect(db.pgsql("SELECT 1")).rejects.toThrow();
    });
});
