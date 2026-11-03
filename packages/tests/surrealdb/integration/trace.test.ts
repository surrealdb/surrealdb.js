import { beforeAll, describe, expect, test } from "bun:test";
import { satisfies } from "semver";
import { dedupeTrace, RecordId } from "surrealdb";
import { createSurreal, requestVersion } from "./__helpers__";

const { version } = await requestVersion();

/** The option is SurrealDB 4.0's, and is refused as unknown by a server which is older */
const IS_4X = satisfies(version, ">=4.0.0-0", { includePrerelease: true });

/**
 * Whether the server takes the option, which a 4.0 build only does once it has the feature. It is
 * learned once the server is up, which is after this file is loaded, so a test reads it from here.
 */
const server = { trace: false };

const SEED = `
    CREATE person:tobie SET name = "Tobie";
    CREATE tag:rust, tag:db;
    CREATE post:1 SET title = "One", author = person:tobie;
    CREATE post:2 SET title = "Two", author = person:tobie;
    RELATE post:1->tagged:a->tag:rust;
    RELATE post:1->tagged:b->tag:db;
    RELATE post:2->tagged:c->tag:rust;
`;

const QUERY = "SELECT title, author.name, ->tagged->tag AS tags FROM post ORDER BY id";

describe.if(IS_4X)("query trace", () => {
    beforeAll(async () => {
        const surreal = await createSurreal();

        try {
            await surreal.query("RETURN 1").trace("relations").collect();
            server.trace = true;
        } catch (error) {
            console.warn(
                `SurrealDB ${version} does not take the trace option, so it is not tested: ${error}`,
            );
        }

        await surreal.close();
    });

    test("a statement reports the edges and links its result read through", async () => {
        if (!server.trace) return;

        const surreal = await createSurreal();

        await surreal.query(SEED).collect();

        const [response] = await surreal.query(QUERY).trace("relations", "links").responses();

        expect(response?.success).toBe(true);
        if (!response?.success) return;

        const trace = dedupeTrace(response.trace ?? {});
        const relations = (trace.relations ?? []).map((r) => `${r.in}>${r.edge}>${r.out}`).sort();

        expect(relations).toEqual([
            "post:1>tagged:a>tag:rust",
            "post:1>tagged:b>tag:db",
            "post:2>tagged:c>tag:rust",
        ]);
        expect(trace.links?.map((l) => [String(l.record), l.field, String(l.target)])).toEqual(
            expect.arrayContaining([["post:1", "author", "person:tobie"]]),
        );
    });

    test("a query which asks for none gets none", async () => {
        if (!server.trace) return;

        const surreal = await createSurreal();

        await surreal.query(SEED).collect();

        const [response] = await surreal.query(QUERY).responses();

        expect(response?.success && response).not.toHaveProperty("trace");
    });

    test("the stream carries it on its frames, and the statement's variables on done", async () => {
        if (!server.trace) return;

        const surreal = await createSurreal();

        await surreal.query(SEED).collect();

        const seen = { relations: 0, variables: undefined as unknown, rows: 0 };

        for await (const frame of surreal
            .query(`LET $x = 1; ${QUERY}`)
            .trace("relations", "variables")
            .stream()) {
            if (frame.isValue()) seen.rows++;
            if (frame.isValue() || frame.isDone()) {
                seen.relations += frame.trace?.relations?.length ?? 0;
                if (frame.trace?.variables) seen.variables = frame.trace.variables;
            }
        }

        expect(seen.rows).toBe(3);
        expect(seen.relations).toBeGreaterThanOrEqual(3);
        expect(seen.variables).toEqual({ x: 1 });
    });

    test("a kind which does not exist is refused before anything is sent", async () => {
        const surreal = await createSurreal();

        expect(() => surreal.query("RETURN 1").trace("edges" as never)).toThrow(TypeError);
    });

    test("record ids in a trace are record ids", async () => {
        if (!server.trace) return;

        const surreal = await createSurreal();

        await surreal.query(SEED).collect();

        const [response] = await surreal.query(QUERY).trace("relations").responses();

        if (!response?.success) throw new Error("the query failed");

        expect(response.trace?.relations?.[0]?.edge).toBeInstanceOf(RecordId);
    });
});
