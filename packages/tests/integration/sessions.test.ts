import { describe, expect, test } from "bun:test";
import { satisfies } from "semver";
import { Features } from "surrealdb";
import { createSurreal, requestVersion, respawnServer, SURREAL_PROTOCOL } from "./__helpers__";

const version = await requestVersion();
const is3x = satisfies(version, ">=3.0.0-alpha.1");

describe.if(is3x && SURREAL_PROTOCOL === "ws")("sessions", async () => {
    test("feature", async () => {
        const surreal = await createSurreal();

        expect(surreal.isFeatureSupported(Features.Sessions)).toBeTrue();
    });

    test("default session is undefined", async () => {
        const surreal = await createSurreal();

        expect(surreal.isValid).toBeTrue();
        expect(surreal.session).toBeUndefined();
    });

    test("newSession()", async () => {
        const surreal = await createSurreal();

        await surreal.set("foo", "bar");

        const session = await surreal.newSession();

        expect(surreal.session).not.toEqual(session.session);
        expect(surreal.parameters.foo).toEqual("bar");

        expect(session.isValid).toBeTrue();
        expect(session.session).toBeDefined();
        expect(session.parameters.foo).toBeUndefined();
        expect(session.namespace).toBeUndefined();
        expect(session.database).toBeUndefined();
    });

    test("forkSession()", async () => {
        const surreal = await createSurreal();

        await surreal.set("foo", "bar");

        const session = await surreal.forkSession();

        expect(surreal.session).not.toEqual(session.session);
        expect(surreal.parameters.foo).toEqual("bar");

        expect(session.isValid).toBeTrue();
        expect(session.session).toBeDefined();
        expect(session.parameters.foo).toEqual("bar");
    });

    test("closeSession()", async () => {
        const surreal = await createSurreal();
        const session = await surreal.forkSession();

        expect(session.isValid).toBeTrue();

        await session.closeSession();

        expect(session.isValid).toBeFalse();
    });

    test("request sessions list", async () => {
        const surreal = await createSurreal();
        const session = await surreal.forkSession();

        expect(surreal.session).not.toEqual(session.session);

        // guarantee session existence
        await session.set("foo", "bar");

        const sessions = await surreal.sessions();

        expect(sessions.length).toBe(1);
        expect(sessions[0].equals(session.session)).toBeTrue();
    });

    test("session isolation", async () => {
        const surreal = await createSurreal();

        const session1 = await surreal.forkSession();
        const session2 = await surreal.forkSession();

        await session1.set("foo", "hello");
        await session2.set("foo", "world");

        const [result1] = await session1.query("RETURN $foo").collect<[string]>();
        const [result2] = await session2.query("RETURN $foo").collect<[string]>();

        expect(result1).toBe("hello");
        expect(result2).toBe("world");

        const sessions = await surreal.sessions();

        expect(sessions.length).toBe(2);
    });

    test("restore state after reconnect", async () => {
        const surreal = await createSurreal({
            // printDiagnostics: true,
            reconnect: {
                enabled: true,
            },
        });

        await surreal.set("foo", "bar");

        const session = await surreal.forkSession();

        await session.set("hello", "world");

        await respawnServer();

        const [foo, hello] = await session
            .query("RETURN $foo; RETURN $hello")
            .collect<[string, string]>();

        expect(foo).toBe("bar");
        expect(hello).toBe("world");
    });

    test("await using", async () => {
        const surreal = await createSurreal();

        await using session = await surreal.forkSession();

        expect(session.isValid).toBeTrue();
    });
});
