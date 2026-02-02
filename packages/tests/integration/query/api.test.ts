import { describe, expect, test } from "bun:test";
import { UnsuccessfulApiError } from "surrealdb";
import { createSurreal, defineMockApi, proto } from "../__helpers__";

declare module "surrealdb" {
    interface SurrealApiGetPaths {
        "/identity": [];
    }
}

type Payload = {
    foo: string;
};

describe("api", async () => {
    test("invoke", async () => {
        const surreal = await createSurreal();
        await defineMockApi(surreal);

        const body: Payload = {
            foo: "bar",
        };

        const res = await surreal.api.invoke<Payload, Payload>("/identity", { body });

        expect(res).toMatchObject({
            body,
            headers: {},
            status: 200,
        });
    });

    test("global headers", async () => {
        const surreal = await createSurreal();
        await defineMockApi(surreal);

        surreal.api.header("X-Test", "test");

        const res = await surreal.api.invoke<Payload, Payload>("/identity");

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

        const res = await surreal.api
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

        const res = await surreal.api.invoke<Payload, Payload>("/params").query("foo", "bar");

        expect(res).toMatchObject({
            body: {
                foo: "bar",
            },
            status: 200,
        });
    });

    test("method specific", async () => {
        const surreal = await createSurreal();
        await defineMockApi(surreal);

        const body: Payload = {
            foo: "bar",
        };

        const res = await surreal.api.get("/identity").value();

        expect(res).toMatchObject({
            body,
            headers: {},
            status: 200,
        });
    });

    test("value", async () => {
        const surreal = await createSurreal();
        await defineMockApi(surreal);

        const body: Payload = {
            foo: "bar",
        };

        // Successful
        const res = await surreal.api.invoke<Payload, Payload>("/identity", { body }).value();

        expect(res.foo).toEqual("bar");

        // Unsuccessful
        expect(async () => {
            await surreal.api.invoke<Payload, Payload>("/error", { body }).value();
        }).toThrow(UnsuccessfulApiError);
    });

    test("compile", async () => {
        const surreal = await createSurreal();
        const builder = surreal.api.invoke<Payload, Payload>("/identity", {});
        const { query, bindings } = builder.compile();

        expect(query).toMatchSnapshot(proto("query"));
        expect(bindings).toMatchSnapshot(proto("bindings"));
    });
});
