import { describe, expect, test } from "bun:test";
import {
    applyDiagnostics,
    BoundQuery,
    type Diagnostic,
    RecordId,
    ServerError,
    surql,
    Table,
} from "surrealdb";
import {
    createSurreal,
    defineMockApi,
    getEngines,
    type Person,
    personTable,
    requestVersion,
    SURREAL_PROTOCOL,
} from "../__helpers__";

const { is3x } = await requestVersion();

describe("query() with an array", async () => {
    test("runs strings, bound queries, builders and queries together", async () => {
        const surreal = await createSurreal();
        const john = new RecordId("person", "john");

        const [one, two, created, selected, last] = await surreal
            .query<[number, number, Person, Person[], number]>([
                "RETURN 1",
                surql`RETURN ${2}`,
                surreal.create<Person>(john).content({ firstname: "John", lastname: "Doe" }),
                surreal.select<Person>(personTable),
                surreal.query("RETURN 5"),
            ])
            .collect();

        expect(one).toBe(1);
        expect(two).toBe(2);
        expect(created).toMatchObject({ firstname: "John", lastname: "Doe" });
        expect(created.id.equals(john)).toBeTrue();
        expect(selected).toHaveLength(1);
        expect(selected[0].id.equals(john)).toBeTrue();
        expect(last).toBe(5);
    });

    test("is awaitable", async () => {
        const surreal = await createSurreal();
        const results = await surreal.query<[1, 2]>(["RETURN 1", "RETURN 2"]);

        expect(results).toEqual([1, 2]);
    });

    test("sends a single request", async () => {
        const events: Diagnostic[] = [];
        const engines = await getEngines();
        const surreal = await createSurreal({
            driverOptions: {
                engines: applyDiagnostics(engines, (event) => {
                    events.push(event);
                }),
            },
        });

        events.length = 0;

        await surreal.query(["RETURN 1", "RETURN 2", "RETURN 3"]).collect();

        const requests = events.filter((e) => e.type === "query" && e.phase === "before");

        expect(requests).toHaveLength(1);
    });

    test("binds the parameters of every query", async () => {
        const surreal = await createSurreal();
        const [a, b, c] = await surreal
            .query<[string, number, boolean]>([
                new BoundQuery("RETURN $name", { name: "Tobie" }),
                surql`RETURN ${42}`,
                new BoundQuery("RETURN $flag", { flag: true }),
            ])
            .collect();

        expect(a).toBe("Tobie");
        expect(b).toBe(42);
        expect(c).toBe(true);
    });

    test("sees the variables defined on the session", async () => {
        const surreal = await createSurreal();
        await surreal.set("greeting", "hello");

        expect(await surreal.query<[string, string]>(["RETURN $greeting", "RETURN 'x'"])).toEqual([
            "hello",
            "x",
        ]);
    });

    test("an empty list runs nothing", async () => {
        const surreal = await createSurreal();

        expect(await surreal.query([])).toEqual([]);
    });

    describe("result mapping", () => {
        test("results are positional per statement, not per input", async () => {
            const surreal = await createSurreal();
            await surreal.query(/* surql */ `DEFINE TABLE person SCHEMALESS`);

            // The first input holds two statements, which shifts the second input to the third slot
            const results = await surreal
                .query<[1, 2, 3, Person[]]>([
                    "RETURN 1; RETURN 2",
                    "RETURN 3",
                    surreal.select<Person>(personTable),
                ])
                .collect();

            expect(results).toEqual([1, 2, 3, []]);
        });

        test("equals the same statements written as a single query", async () => {
            const surreal = await createSurreal();

            const batched = await surreal.query(["RETURN 1", "RETURN [1, 2]", "RETURN { a: 1 }"]);
            const single = await surreal.query("RETURN 1; RETURN [1, 2]; RETURN { a: 1 }");

            expect(batched).toEqual(single);
        });

        test("a builder takes exactly one slot", async () => {
            const surreal = await createSurreal();
            await surreal.query(/* surql */ `DEFINE TABLE person SCHEMALESS`);

            const results = await surreal.query<[Person[], Person | undefined, number]>([
                surreal.select<Person>(personTable),
                surreal.select<Person>(new RecordId("person", "nobody")),
                "RETURN 3",
            ]);

            expect(results).toEqual([[], undefined, 3]);
        });

        test("collects specific statements", async () => {
            const surreal = await createSurreal();
            const [first, third] = await surreal
                .query(["RETURN 1", "RETURN 2", "RETURN 3"])
                .collect<[1, 3]>(0, 2);

            expect(first).toBe(1);
            expect(third).toBe(3);
        });

        test("input which ends with a semicolon or a line comment is fine", async () => {
            const surreal = await createSurreal();

            const results = await surreal.query<[1, 2, 3]>([
                "RETURN 1;",
                "RETURN 2 -- the second",
                "RETURN 3 # the third",
            ]);

            expect(results).toEqual([1, 2, 3]);
        });
    });

    describe("failures", () => {
        test("responses tells which statement failed and keeps the others", async () => {
            const surreal = await createSurreal();
            const [first, second, third] = await surreal
                .query<[1, never, 3]>(["RETURN 1", "THROW 'boom'", "RETURN 3"])
                .responses();

            expect(first.success).toBeTrue();
            expect(first.success && first.result).toBe(1);
            expect(first.stats).toBeDefined();

            expect(second.success).toBeFalse();
            expect(!second.success && second.error).toBeInstanceOf(ServerError);
            expect(!second.success && second.error.message).toContain("boom");
            expect(second.stats).toBeDefined();

            expect(third.success).toBeTrue();
            expect(third.success && third.result).toBe(3);
            expect(third.stats).toBeDefined();
        });

        test("a failure in one input does not hide the others, whichever kind they are", async () => {
            const surreal = await createSurreal();
            const john = new RecordId("person", "john");
            const created = surreal
                .create<Person>(john)
                .content({ firstname: "John", lastname: "Doe" });

            const responses = await surreal
                .query([created, surql`THROW ${"boom"}`, surreal.select<Person>(personTable)])
                .responses();

            expect(responses.map((r) => r.success)).toEqual([true, false, true]);

            const last = responses[2];
            expect(last.success && (last.result as Person[])).toHaveLength(1);
        });

        test("is not atomic, as everything which did not fail stays", async () => {
            const surreal = await createSurreal();

            const responses = await surreal
                .query([
                    "CREATE person:a SET firstname = 'A'",
                    "THROW 'boom'",
                    "CREATE person:b SET firstname = 'B'",
                ])
                .responses();

            expect(responses.map((r) => r.success)).toEqual([true, false, true]);

            const people = await surreal.select<Person>(personTable);

            expect(people.map((p) => p.firstname).sort()).toEqual(["A", "B"]);
        });

        test("collect rejects with the error of the failing statement", async () => {
            const surreal = await createSurreal();

            const promise = surreal.query(["RETURN 1", "THROW 'boom'", "RETURN 3"]).collect();

            await expect(promise).rejects.toBeInstanceOf(ServerError);
            await expect(promise).rejects.toThrow("boom");
        });

        test("a query which cannot be parsed fails as a whole", async () => {
            const surreal = await createSurreal();

            // The server rejects the request before running any statement of it, as it would
            // for one query with a syntax error in the middle.
            const promise = surreal.query(["RETURN 1", "SEL ECT oops", "RETURN 3"]).responses();

            await expect(promise).rejects.toBeInstanceOf(ServerError);
        });

        test("two queries binding the same parameter are rejected, naming both", async () => {
            const surreal = await createSurreal();

            expect(() =>
                surreal.query([
                    new BoundQuery("RETURN $id", { id: 1 }),
                    "RETURN 2",
                    new BoundQuery("RETURN $id", { id: 3 }),
                ]),
            ).toThrow(/'\$id' is bound by both queries\[0\] and queries\[2\]/);
        });

        test("an input which is empty is rejected, naming it", async () => {
            const surreal = await createSurreal();

            expect(() => surreal.query(["RETURN 1", ""])).toThrow("queries[1] is empty");
        });
    });

    describe("configuring the query", () => {
        test("streams frames which belong to their statement", async () => {
            const surreal = await createSurreal();
            await surreal.query(
                /* surql */ `CREATE |person:1..3| SET firstname = 'x', lastname = 'y'`,
            );

            const values: Record<number, unknown[]> = {};
            const done: number[] = [];
            const errors: number[] = [];

            const stream = surreal
                .query(["RETURN 'before'", surreal.select<Person>(personTable), "THROW 'boom'"])
                .stream();

            for await (const frame of stream) {
                if (frame.isValue()) {
                    values[frame.query] = [...(values[frame.query] ?? []), frame.value];
                } else if (frame.isDone()) {
                    done.push(frame.query);
                } else if (frame.isError()) {
                    errors.push(frame.query);
                }
            }

            expect(values[0]).toEqual(["before"]);
            expect(values[1]?.length).toBeGreaterThanOrEqual(2);
            expect(values[2]).toBeUndefined();
            expect(done.sort()).toEqual([0, 1]);
            expect(errors).toEqual([2]);
        });

        test("json", async () => {
            const surreal = await createSurreal();
            const [id, date] = await surreal
                .query<[RecordId, Date]>(["RETURN person:john", "RETURN d'2024-05-06T17:44:57Z'"])
                .json()
                .collect();

            expect(id).toBe("person:john");
            expect(typeof date).toBe("string");
        });

        test("retry", async () => {
            const surreal = await createSurreal();
            const results = await surreal.query<[1, 2]>(["RETURN 1", "RETURN 2"]).retry().collect();

            expect(results).toEqual([1, 2]);
        });

        test("inner is the combined query", async () => {
            const surreal = await createSurreal();
            const { query, bindings } = surreal.query(["RETURN 1", surql`RETURN ${2}`]).inner;

            expect(query).toStartWith("RETURN 1");
            expect(query.split(";")).toHaveLength(2);
            expect(Object.values(bindings)).toEqual([2]);
        });
    });

    describe("builders", () => {
        test("every kind of builder can be combined", async () => {
            const surreal = await createSurreal();
            const mary = new RecordId("person", "mary");
            const john = new RecordId("person", "john");

            await surreal.query(/* surql */ `
                DEFINE FUNCTION fn::double($n: number) { RETURN $n * 2 };
            `);

            const results = await surreal.query([
                surreal.create<Person>(john).content({ firstname: "John", lastname: "Doe" }),
                surreal.insert<Person>(personTable, {
                    id: mary,
                    firstname: "Mary",
                    lastname: "Doe",
                }),
                surreal.upsert<Person>(john).merge({ age: 40 }),
                surreal.update<Person>(mary).merge({ age: 38 }),
                surreal.relate(john, new Table("knows"), mary),
                surreal.run<number>("fn::double", [21]),
                surreal.select<Person>(john),
                surreal.delete<Person>(mary),
            ]);

            expect(results).toHaveLength(8);
            expect(results[5]).toBe(42);
            expect(results[6]).toMatchObject({ firstname: "John", age: 40 });
        });
    });
});

describe.if(is3x)("query() with an array and api()", async () => {
    test("can combine an api request with other queries", async () => {
        const surreal = await createSurreal();
        await defineMockApi(surreal);

        const [first, response] = await surreal.query<[1, { body: string }]>([
            "RETURN 1",
            surreal.api().get("/nested/path"),
        ]);

        expect(first).toBe(1);
        expect(response).toMatchObject({ body: "nested" });
    });
});

// Interactive transactions need a stateful connection
describe.if(is3x && (SURREAL_PROTOCOL === "ws" || SURREAL_PROTOCOL === "mem"))(
    "query() with an array inside a transaction",
    async () => {
        test("runs inside the transaction", async () => {
            const surreal = await createSurreal();
            await surreal.query(/* surql */ `DEFINE TABLE person SCHEMALESS`);
            const txn = await surreal.beginTransaction();
            const john = new RecordId("person", "john");
            const mary = new RecordId("person", "mary");

            const [created, other, count] = await txn
                .query<[Person, Person, number]>([
                    txn.create<Person>(john).content({ firstname: "John", lastname: "Doe" }),
                    "CREATE ONLY person:mary SET firstname = 'Mary', lastname = 'Doe'",
                    "RETURN count(SELECT * FROM person)",
                ])
                .collect();

            expect(created.firstname).toBe("John");
            expect(other.firstname).toBe("Mary");
            expect(count).toBe(2);

            // Not visible outside of the transaction until it is committed
            expect(await surreal.select<Person>(john)).toBeUndefined();

            await txn.commit();

            expect(await surreal.select<Person>(john)).toMatchObject({ firstname: "John" });
            expect(await surreal.select<Person>(mary)).toMatchObject({ firstname: "Mary" });
        });

        test("is discarded when the transaction is cancelled", async () => {
            const surreal = await createSurreal();
            await surreal.query(/* surql */ `DEFINE TABLE person SCHEMALESS`);
            const txn = await surreal.beginTransaction();

            await txn.query(["CREATE person:john", "CREATE person:mary"]);
            await txn.cancel();

            expect(await surreal.select<Person>(personTable)).toEqual([]);
        });
    },
);
