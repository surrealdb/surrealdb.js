import { afterEach, describe, expect, test } from "bun:test";
import { HttpConnectionError, Surreal } from "surrealdb";
import { connectFake } from "./__helpers__/mock-engine";
import {
    bearerOf,
    createJwtExpiringIn,
    createMockFetch,
    type MockHandler,
} from "./__helpers__/mock-fetch";

let open: Surreal | undefined;

afterEach(async () => {
    await open?.close();
    open = undefined;
});

/** The server has no `health` RPC method, so anything which asks for one is answered as it would be */
const serving =
    (health: number): MockHandler =>
    (request) => {
        if (request.rpc?.method === "signin") return { result: createJwtExpiringIn(3600) };
        if (request.rpc) return { error: { code: -32601, message: "Method not found" } };
        if (new URL(request.url).pathname.endsWith("/health")) return { status: health };

        throw new Error(`Nothing is routed for ${request.url}`);
    };

async function connect(url: string, handler: MockHandler) {
    const server = createMockFetch(handler);
    const db = new Surreal({ fetchImpl: server.fetchImpl });
    open = db;

    await db.connect(url, {
        versionCheck: false,
        authentication: { username: "root", password: "root" },
    });

    return { db, server };
}

describe("health()", () => {
    test("asks the /health endpoint, without a credential", async () => {
        const { db, server } = await connect("http://localhost:8000/rpc", serving(200));

        await db.health();

        const [request] = server.calls.filter((call) => !call.rpc);

        expect(request?.method).toBe("GET");
        expect(new URL(request?.url ?? "").pathname).toBe("/health");
        expect(request && bearerOf(request)).toBeUndefined();
        expect(server.calls.some((call) => call.rpc?.method === "health")).toBe(false);
    });

    test("keeps the path the server is mounted under", async () => {
        const { db, server } = await connect("http://localhost:8000/surreal/rpc", serving(200));

        await db.health();

        const [request] = server.calls.filter((call) => !call.rpc);

        expect(new URL(request?.url ?? "").pathname).toBe("/surreal/health");
    });

    test("rejects when the server is not healthy", async () => {
        const { db } = await connect("http://localhost:8000/rpc", serving(500));

        await expect(db.health()).rejects.toBeInstanceOf(HttpConnectionError);
    });

    test("an engine of its own, which is not reached over HTTP, asks with ping", async () => {
        const { db, engine } = await connectFake();
        open = db;
        engine.respond = async () => undefined;

        await db.health();

        expect(engine.sent.map(({ request }) => request.method)).toEqual(["ping"]);
    });
});
