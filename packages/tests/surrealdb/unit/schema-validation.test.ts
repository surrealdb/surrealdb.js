import { afterEach, describe, expect, test } from "bun:test";
import { SchemaValidationError, type StandardSchemaV1, type Surreal } from "surrealdb";
import { connectFake } from "./__helpers__/mock-engine";

let open: Surreal | undefined;

afterEach(async () => {
    await open?.close();
    open = undefined;
});

async function connect() {
    const connected = await connectFake();
    open = connected.db;
    return connected;
}

const ok = (result: unknown) => [{ status: "OK", time: "1ms", result, type: "other" }];

/** A minimal Standard Schema, so the tests need no validation library. */
function schema<T>(
    check: (value: unknown) => string[],
    transform?: (value: unknown) => T,
): StandardSchemaV1<unknown, T> {
    return {
        "~standard": {
            version: 1,
            vendor: "test",
            validate: (value) => {
                const messages = check(value);

                return messages.length
                    ? { issues: messages.map((message) => ({ message, path: ["x"] })) }
                    : { value: (transform ? transform(value) : value) as T };
            },
        },
    };
}

const numbers = schema<[number, number]>((v) =>
    Array.isArray(v) && v.every((n) => typeof n === "number") && v.length === 2
        ? []
        : ["expected two numbers"],
);
const aNumber = schema<number>((v) => (typeof v === "number" ? [] : ["expected a number"]));
const body = schema<{ name: string }>((v) =>
    typeof v === "object" && v !== null && typeof (v as { name?: unknown }).name === "string"
        ? []
        : ["name is required"],
);

async function caught(promise: PromiseLike<unknown>): Promise<unknown> {
    try {
        await promise;
    } catch (error) {
        return error;
    }

    throw new Error("Expected the promise to reject");
}

describe("run() schemas", () => {
    test("args() rejects invalid arguments and sends nothing", async () => {
        const { db, engine } = await connect();
        const error = await caught(db.run("fn::add", ["a", 2]).args(numbers));

        expect(error).toBeInstanceOf(SchemaValidationError);
        expect((error as SchemaValidationError).subject).toBe("arguments for fn::add");
        expect((error as SchemaValidationError).issues).toHaveLength(1);
        expect((error as Error).message).toContain("x: expected two numbers");
        expect(engine.sent).toHaveLength(0);
    });

    test("args() lets valid arguments through, and sends what the schema produced", async () => {
        const { db, engine } = await connect();
        engine.respond = async () => ok(3);
        const doubled = schema<number[]>(
            () => [],
            (v) => (v as number[]).map((n) => n * 2),
        );

        expect(await db.run<number>("fn::add", [1, 2]).args(doubled)).toBe(3);
        expect(JSON.stringify(engine.sent[0]?.request)).toContain('"bind__1":2,"bind__2":4');
    });

    test("returns() types and validates the result", async () => {
        const { db, engine } = await connect();
        engine.respond = async () => ok(3);

        const sum: number = await db.run("fn::add", [1, 2]).returns(aNumber);
        expect(sum).toBe(3);

        engine.respond = async () => ok("three");
        const error = await caught(db.run("fn::add", [1, 2]).returns(aNumber));
        expect(error).toBeInstanceOf(SchemaValidationError);
        expect((error as SchemaValidationError).subject).toBe("result of fn::add");
    });

    test("schemas survive other chained methods", async () => {
        const { db, engine } = await connect();
        const error = await caught(db.run("fn::add", ["a"]).args(numbers).retry().json());
        expect(error).toBeInstanceOf(SchemaValidationError);
        expect(engine.sent).toHaveLength(0);
    });

    test("an asynchronous schema is awaited", async () => {
        const { db, engine } = await connect();
        engine.respond = async () => ok(3);
        const later: StandardSchemaV1<unknown, number> = {
            "~standard": {
                version: 1,
                vendor: "test",
                validate: async (value) => ({ value: value as number }),
            },
        };

        expect(await db.run("fn::add", [1, 2]).returns(later)).toBe(3);
    });
});

describe("api() schemas", () => {
    const reply = (status: number, responseBody: unknown) =>
        ok({ status, body: responseBody, headers: {} });

    test("request() rejects an invalid body and sends nothing", async () => {
        const { db, engine } = await connect();
        const error = await caught(db.api().post("/users", {}).request(body));

        expect(error).toBeInstanceOf(SchemaValidationError);
        expect((error as SchemaValidationError).subject).toBe("request body for POST /users");
        expect(engine.sent).toHaveLength(0);
    });

    test("request() lets a valid body through", async () => {
        const { db, engine } = await connect();
        engine.respond = async () => reply(200, { name: "Ada" });

        const response = await db.api().post("/users", { name: "Ada" }).request(body);
        expect(response.status).toBe(200);
        expect(engine.sent).toHaveLength(1);
    });

    test("response() validates the body, with and without value()", async () => {
        const { db, engine } = await connect();
        engine.respond = async () => reply(200, { name: "Ada" });

        const user: { name: string } = await db.api().get("/users/1").response(body).value();
        expect(user.name).toBe("Ada");

        const full = await db.api().get("/users/1").response(body);
        expect(full.body?.name).toBe("Ada");

        engine.respond = async () => reply(200, { nope: true });
        const error = await caught(db.api().get("/users/1").response(body));
        expect((error as SchemaValidationError).subject).toBe("response body of GET /users/1");
    });

    test("response() leaves the body of an unsuccessful response alone", async () => {
        const { db, engine } = await connect();
        engine.respond = async () => reply(404, { error: "not found" });

        const response = await db.api().get("/users/9").response(body);
        expect(response.status).toBe(404);
    });
});
