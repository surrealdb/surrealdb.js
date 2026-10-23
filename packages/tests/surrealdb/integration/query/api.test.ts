import { describe, expect, test } from "bun:test";
import { Features, RecordId, UnsuccessfulApiError } from "surrealdb";
import { createSurreal, defineMockApi, proto, requestVersion } from "../__helpers__";

type ExamplePaths = {
    "/identity": { get: [unknown, Payload] };
};

type Payload = {
    foo: string;
};

const { is3x } = await requestVersion();

describe.if(is3x)("api", async () => {
    test("invoke", async () => {
        const surreal = await createSurreal();
        const api = surreal.api();
        await defineMockApi(surreal);

        const body: Payload = {
            foo: "bar",
        };

        const res = await api.invoke<Payload, Payload>("/identity", { body, method: "post" });

        expect(res).toMatchObject({
            body,
            headers: {},
            status: 200,
        });
    });

    test("global headers", async () => {
        const surreal = await createSurreal();
        const api = surreal.api();
        await defineMockApi(surreal);

        api.header("X-Test", "test");

        const res = await api.invoke<Payload, Payload>("/identity");

        expect(res).toMatchObject({
            status: 200,
            headers: {
                "x-test": "test",
            },
        });
    });

    test("request headers", async () => {
        const surreal = await createSurreal();
        await defineMockApi(surreal);

        const res = await surreal
            .api()
            .invoke<Payload, Payload>("/identity")
            .header("X-Test", "test");

        expect(res).toMatchObject({
            status: 200,
            headers: {
                "x-test": "test",
            },
        });
    });

    test("request params", async () => {
        const surreal = await createSurreal();
        await defineMockApi(surreal);

        const res = await surreal
            .api()
            .invoke<Payload, Payload>("/params")
            .query("hello", "world")
            .query("foo", "bar");

        expect(res).toMatchObject({
            body: {
                foo: "bar",
                hello: "world",
            },
            status: 200,
        });
    });

    test("method specific", async () => {
        const surreal = await createSurreal();
        const api = surreal.api<ExamplePaths>();
        await defineMockApi(surreal);

        const res = await api.get("/identity");

        expect(res).toMatchObject({
            body: undefined,
            headers: {},
            status: 200,
        });
    });

    test("value", async () => {
        const surreal = await createSurreal();
        const api = surreal.api();
        await defineMockApi(surreal);

        const body: Payload = {
            foo: "bar",
        };

        // Successful
        const res = await api
            .invoke<Payload, Payload>("/identity", { body, method: "post" })
            .value();

        expect(res.foo).toEqual("bar");

        // Unsuccessful
        expect(async () => {
            await api.invoke<Payload, Payload>("/error", { body, method: "post" }).value();
        }).toThrow(UnsuccessfulApiError);
    });

    test("prefix", async () => {
        const surreal = await createSurreal();
        const api = surreal.api<ExamplePaths>("/nested");
        await defineMockApi(surreal);

        const res = await api.invoke("/path");

        expect(res).toMatchObject({
            body: "nested",
            headers: {},
            status: 200,
        });
    });

    test("joins the transaction it is invoked in", async () => {
        const surreal = await createSurreal();
        if (!surreal.isFeatureSupported(Features.Transactions)) return;

        await surreal.query(`
            DEFINE TABLE person SCHEMALESS;
            DEFINE API '/touch' FOR get THEN {
                CREATE person:api;
                RETURN { status: 200, body: true };
            };
        `);

        const txn = await surreal.beginTransaction();
        const res = await txn.api().get("/touch");

        expect(res.status).toBe(200);
        expect(await txn.select(new RecordId("person", "api"))).toBeDefined();
        expect(await surreal.select(new RecordId("person", "api"))).toBeUndefined();

        await txn.cancel();

        expect(await surreal.select(new RecordId("person", "api"))).toBeUndefined();
    });

    test("compile", async () => {
        const surreal = await createSurreal();
        const builder = surreal.api().invoke<Payload, Payload>("/identity", {});
        const { query, bindings } = builder.compile();

        expect(query).toMatchSnapshot(proto("query"));
        expect(bindings).toMatchSnapshot(proto("bindings"));
    });
});
