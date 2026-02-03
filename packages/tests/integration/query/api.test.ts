import { describe, expect, test } from "bun:test";
import { satisfies } from "semver";
import { UnsuccessfulApiError } from "surrealdb";
import { createSurreal, defineMockApi, proto, requestVersion } from "../__helpers__";

type ExamplePaths = {
    "/identity": { get: [unknown, Payload] };
};

type Payload = {
    foo: string;
};

const version = await requestVersion();
const is3x = satisfies(version, ">=3.0.0-alpha.1");

describe.if(is3x)("api", async () => {
    test("invoke", async () => {
        const surreal = await createSurreal();
        const api = surreal.api();
        await defineMockApi(surreal);

        const body: Payload = {
            foo: "bar",
        };

        const res = await api.invoke<Payload, Payload>("/identity", { body });

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
        const res = await api.invoke<Payload, Payload>("/identity", { body }).value();

        expect(res.foo).toEqual("bar");

        // Unsuccessful
        expect(async () => {
            await api.invoke<Payload, Payload>("/error", { body }).value();
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

    test("compile", async () => {
        const surreal = await createSurreal();
        const builder = surreal.api().invoke<Payload, Payload>("/identity", {});
        const { query, bindings } = builder.compile();

        expect(query).toMatchSnapshot(proto("query"));
        expect(bindings).toMatchSnapshot(proto("bindings"));
    });
});
