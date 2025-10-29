import { describe, expect, mock, test } from "bun:test";
import { RecordId } from "surrealdb";
import { setupServer, VERSION_CHECK } from "./__helpers__";

const { createSurreal, createIdleSurreal } = await setupServer();

describe("connection", async () => {
    test.todoIf(!VERSION_CHECK)("check version", async () => {
        const surreal = await createSurreal();

        const { version } = await surreal.version();
        expect(version.startsWith("surrealdb-")).toBe(true);
    });

    test("allowed rpcs without namespace or database", async () => {
        const surreal = await createSurreal({
            unselected: true,
        });

        await surreal.version();
        await surreal.invalidate();
    });

    test("disallowed rpcs without namespace or database", async () => {
        const surreal = await createSurreal({
            unselected: true,
        });

        expect(async () => {
            await surreal.query("SELECT * FROM test");
        }).toThrow();
    });

    test("access selected namespace and database", async () => {
        const surreal = await createSurreal({
            unselected: true,
        });

        await surreal.use({
            namespace: "test-ns",
            database: "test-db",
        });

        expect(surreal.namespace).toBe("test-ns");
        expect(surreal.database).toBe("test-db");
    });

    test("connection status", async () => {
        const { surreal, connect } = createIdleSurreal();

        expect(surreal.status).toBe("disconnected");
        connect();
        expect(surreal.status).toBe("connecting");
        await surreal.ready;
        expect(surreal.status).toBe("connected");
        await surreal.close();
        expect(surreal.status).toBe("disconnected");
    });

    test("access token", async () => {
        const surreal = await createSurreal({
            unselected: true,
        });

        await surreal.ready;

        expect(surreal.accessToken).toBeString();
    });

    test("sequential connects", async () => {
        const { connect } = createIdleSurreal();

        await connect();
        await connect();
        await connect();
        await connect();
        await connect();
    });

    test("unawaited sequential connects", async () => {
        const { connect } = createIdleSurreal();

        connect();
        connect();
        connect();
        connect();

        await connect();
    });

    test("using event", async () => {
        const { surreal, connect } = createIdleSurreal();
        const handle = mock(() => {});

        surreal.subscribe("using", handle);

        await connect({
            namespace: "foo",
            database: "bar",
        });

        await surreal.use({
            namespace: "hello",
            database: null,
        });

        expect(handle).nthCalledWith(1, {
            namespace: "foo",
            database: "bar",
        });

        expect(handle).nthCalledWith(2, {
            namespace: "hello",
            database: undefined,
        });
    });

    test("use seperately", async () => {
        const surreal = await createSurreal();

        await surreal.use({
            namespace: "foo",
        });

        await surreal.use({
            database: "bar",
        });

        expect(surreal.namespace).toBe("foo");
        expect(surreal.database).toBe("bar");

        await surreal.select(new RecordId("person", 1));
    });

    test("use correction", async () => {
        const surreal = await createSurreal();

        await surreal.use({
            namespace: "foo",
        });

        const current = await surreal.use({
            database: "bar",
        });

        expect(current.namespace).toBe("foo");
        expect(current.database).toBe("bar");
    });
});
