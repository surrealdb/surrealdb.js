import { afterEach, describe, expect, test } from "bun:test";
import { Surreal } from "surrealdb";
import {
    routesScopes,
    SURREAL_DB,
    SURREAL_NS,
    SURREAL_PASS,
    SURREAL_PORT,
    SURREAL_PROTOCOL,
    SURREAL_USER,
} from "./__helpers__";

const SCOPE = `/ns/${SURREAL_NS}/db/${SURREAL_DB}`;

const SCOPED = await routesScopes();

let open: Surreal | undefined;

afterEach(async () => {
    await open?.close();
    open = undefined;
});

describe.if(SCOPED)("an endpoint scoped by its path", () => {
    async function connect(): Promise<Surreal> {
        const db = new Surreal();
        open = db;
        await db.connect(`${SURREAL_PROTOCOL}://127.0.0.1:${SURREAL_PORT}${SCOPE}/rpc`, {
            authentication: { username: SURREAL_USER, password: SURREAL_PASS },
        });
        return db;
    }

    test("runs queries in its scope without a use()", async () => {
        const db = await connect();

        expect(db.namespace).toBe(SURREAL_NS);
        expect(db.database).toBe(SURREAL_DB);

        const [ns] = await db.query("RETURN session::ns()").collect<[string]>();
        expect(ns).toBe(SURREAL_NS);
    });

    test("still reaches /health, which takes no scope", async () => {
        const db = await connect();

        await db.health();
    });

    test("returns to its scope on reset()", async () => {
        const db = await connect();

        await db.reset();

        expect(db.namespace).toBe(SURREAL_NS);
        expect(db.database).toBe(SURREAL_DB);

        // A reset signs out as well
        await db.signin({ username: SURREAL_USER, password: SURREAL_PASS });

        const [ns, dbName] = await db
            .query("RETURN session::ns(); RETURN session::db()")
            .collect<[string, string]>();
        expect([ns, dbName]).toEqual([SURREAL_NS, SURREAL_DB]);
    });
});
