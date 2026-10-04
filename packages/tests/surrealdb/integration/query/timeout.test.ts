import { describe, expect, test } from "bun:test";
import { DateTime, Duration, QueryError, RecordId, raw, type Surreal } from "surrealdb";
import {
    createSurreal,
    graphTable,
    insertMockRecords,
    type Person,
    personTable,
    requestVersion,
} from "../__helpers__";

// The `compile` tests of each builder only pin the generated SurrealQL. These tests
// run every builder with `.timeout()` against a server, so a clause which compiles
// but is rejected (or ignored) by the server is caught.

const { is3x } = await requestVersion();

type Edge = {
    id: RecordId<"graph">;
    in: RecordId<"edge">;
    out: RecordId<"edge">;
    num: number;
};

/** Plenty of time for any of the statements below to finish */
const GENEROUS = Duration.seconds(30);

/** Much shorter than the 2 second sleep of the slow statements below */
const TIGHT = Duration.milliseconds(200);

interface Case {
    name: string;

    /** Prepare data before the statement runs (and before the slow event is defined) */
    seed?: (surreal: Surreal) => Promise<unknown>;

    /** The builder under test */
    run: (surreal: Surreal, timeout: Duration) => PromiseLike<unknown>;

    /** Assert the result when the statement finished within the timeout */
    expectResult: (result: unknown) => void;

    /** The table to attach a slow event to, so the statement takes 2 seconds to execute */
    slowTable?: string;

    /** An alternative builder which is slow by itself, for statements which trigger no events */
    runSlow?: (surreal: Surreal, timeout: Duration) => PromiseLike<unknown>;
}

const cases: Case[] = [
    {
        name: "select()",
        seed: insertMockRecords,
        run: (s, t) => s.select<Person>(personTable).timeout(t),
        runSlow: (s, t) => s.select<Person>(personTable).where(raw("sleep(2s) IS NONE")).timeout(t),
        expectResult: (r) => expect(r).toBeArrayOfSize(2),
    },
    {
        name: "create()",
        slowTable: "person",
        run: (s, t) =>
            s
                .create<Person>(new RecordId("person", 1))
                .content({ firstname: "John", lastname: "Doe" })
                .timeout(t),
        expectResult: (r) =>
            expect(r).toStrictEqual({
                id: new RecordId("person", 1),
                firstname: "John",
                lastname: "Doe",
            }),
    },
    {
        name: "insert()",
        slowTable: "person",
        run: (s, t) =>
            s
                .insert<Person>({
                    id: new RecordId("person", 1),
                    firstname: "John",
                    lastname: "Doe",
                })
                .timeout(t),
        expectResult: (r) =>
            expect(r).toStrictEqual([
                {
                    id: new RecordId("person", 1),
                    firstname: "John",
                    lastname: "Doe",
                },
            ]),
    },
    {
        name: "update()",
        seed: insertMockRecords,
        slowTable: "person",
        run: (s, t) =>
            s.update<Person>(new RecordId("person", 1)).merge({ firstname: "Bob" }).timeout(t),
        expectResult: (r) =>
            expect(r).toStrictEqual({
                id: new RecordId("person", 1),
                firstname: "Bob",
                lastname: "Doe",
            }),
    },
    {
        name: "upsert()",
        seed: insertMockRecords,
        slowTable: "person",
        run: (s, t) =>
            s.upsert<Person>(new RecordId("person", 1)).merge({ firstname: "Bob" }).timeout(t),
        expectResult: (r) =>
            expect(r).toStrictEqual({
                id: new RecordId("person", 1),
                firstname: "Bob",
                lastname: "Doe",
            }),
    },
    {
        name: "delete()",
        seed: insertMockRecords,
        slowTable: "person",
        run: (s, t) => s.delete<Person>(new RecordId("person", 1)).timeout(t),
        expectResult: (r) =>
            expect(r).toStrictEqual({
                id: new RecordId("person", 1),
                firstname: "John",
                lastname: "Doe",
            }),
    },
    {
        name: "relate()",
        slowTable: "graph",
        run: (s, t) =>
            s
                .relate<Edge>(new RecordId("edge", "in"), graphTable, new RecordId("edge", "out"), {
                    num: 123,
                })
                .timeout(t),
        expectResult: (r) => {
            const edge = r as Edge;
            expect(edge.in).toStrictEqual(new RecordId("edge", "in"));
            expect(edge.out).toStrictEqual(new RecordId("edge", "out"));
            expect(edge.num).toBe(123);
        },
    },
];

describe("builder timeout()", async () => {
    for (const c of cases) {
        describe(c.name, () => {
            test("completes within a generous timeout", async () => {
                const surreal = await createSurreal();
                await c.seed?.(surreal);

                c.expectResult(await c.run(surreal, GENEROUS));
            });

            // The structured `QueryError` is only reported by SurrealDB 3.x
            test.if(is3x)("fails once the timeout is exceeded", async () => {
                const surreal = await createSurreal();
                await c.seed?.(surreal);

                if (c.slowTable) {
                    await surreal.query(
                        `DEFINE EVENT slow ON TABLE ${c.slowTable} WHEN true THEN { sleep(2s) }`,
                    );
                }

                const run = c.runSlow ?? c.run;
                const error = await run(surreal, TIGHT).then(
                    () => undefined,
                    (err: unknown) => err,
                );

                expect(error).toBeInstanceOf(QueryError);

                const queryError = error as QueryError;
                expect(queryError.kind).toBe("Query");
                expect(queryError.message).toMatch(/exceeded the timeout/);
                expect(queryError.isTimedOut).toBe(true);
                expect(queryError.timeout).toBeInstanceOf(Duration);
                expect(queryError.timeout?.equals(TIGHT)).toBe(true);
            });
        });
    }
});

// The server only accepts `VERSION` before `TIMEOUT`. Not every datastore supports
// versioned queries, so only assert that the statement makes it past the parser.
describe("builder timeout() with version()", async () => {
    const cases: Record<string, (surreal: Surreal) => PromiseLike<unknown>> = {
        "select()": (s) => s.select<Person>(personTable).timeout(GENEROUS).version(new DateTime(0)),
        "create()": (s) =>
            s
                .create<Person>(new RecordId("person", 1))
                .content({ firstname: "John", lastname: "Doe" })
                .timeout(GENEROUS)
                .version(new DateTime(0)),
        "insert()": (s) =>
            s
                .insert<Person>({
                    id: new RecordId("person", 1),
                    firstname: "John",
                    lastname: "Doe",
                })
                .timeout(GENEROUS)
                .version(new DateTime(0)),
    };

    for (const [name, run] of Object.entries(cases)) {
        test(`${name} is parsed by the server`, async () => {
            const surreal = await createSurreal();
            const error = await run(surreal).then(
                () => undefined,
                (err: unknown) => err,
            );

            expect((error as Error | undefined)?.message ?? "").not.toContain("Parse error");
        });
    }
});
