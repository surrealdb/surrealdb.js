import { describe, expect, test } from "bun:test";
import {
    applyDiagnostics,
    BoundQuery,
    type Diagnostic,
    ExpressionError,
    Features,
    QueryError,
    RecordId,
    type RetryOptions,
    ServerError,
    surql,
    Table,
    ThrownError,
    type TransactionOptions,
    UnsupportedFeatureError,
    ValidationError,
} from "surrealdb";
import {
    createIdleSurreal,
    createSurreal,
    getEngines,
    requestVersion,
    SURREAL_PROTOCOL,
} from "./__helpers__";

const { is3x } = await requestVersion();

interface Person {
    id: RecordId<"person">;
    name: string;
}

describe.if(is3x && (SURREAL_PROTOCOL === "ws" || SURREAL_PROTOCOL === "mem"))(
    "transactions",
    async () => {
        test("feature", async () => {
            const surreal = await createSurreal();

            expect(surreal.isFeatureSupported(Features.Transactions)).toBeTrue();
        });

        test("committed transaction", async () => {
            const surreal = await createSurreal();
            await surreal.query(/* surql */ `DEFINE TABLE person SCHEMALESS`);
            const txn = await surreal.beginTransaction();

            const created = await txn.create<Person>(new RecordId("person", "john")).content({
                name: "John Doe",
            });

            expect(created).toStrictEqual({
                id: new RecordId("person", "john"),
                name: "John Doe",
            });

            let selected = await surreal.select<Person>(new RecordId("person", "john"));
            expect(selected).toBeUndefined();

            await txn.commit();

            selected = await surreal.select<Person>(new RecordId("person", "john"));
            expect(selected).toStrictEqual({
                id: new RecordId("person", "john"),
                name: "John Doe",
            });
        });

        test("cancelled transaction", async () => {
            const surreal = await createSurreal();
            await surreal.query(/* surql */ `DEFINE TABLE person SCHEMALESS`);
            const txn = await surreal.beginTransaction();

            const created = await txn.create<Person>(new RecordId("person", "john")).content({
                name: "John Doe",
            });

            expect(created).toStrictEqual({
                id: new RecordId("person", "john"),
                name: "John Doe",
            });

            let selected = await surreal.select<Person>(new RecordId("person", "john"));
            expect(selected).toBeUndefined();

            await txn.cancel();

            selected = await surreal.select<Person>(new RecordId("person", "john"));
            expect(selected).toBeUndefined();
        });

        test("a transaction() is separate from, and not part of, an interactive transaction", async () => {
            const surreal = await createSurreal();
            await surreal.query(/* surql */ `DEFINE TABLE person SCHEMALESS`);
            const txn = await surreal.beginTransaction();

            await txn.create<Person>(new RecordId("person", "inner")).content({ name: "Inner" });

            await surreal.transaction(["CREATE person:outer SET name = 'Outer'"]);

            // The atomic one committed on its own, the interactive one has not
            expect(await surreal.select<Person>(new RecordId("person", "outer"))).toMatchObject({
                name: "Outer",
            });
            expect(await surreal.select<Person>(new RecordId("person", "inner"))).toBeUndefined();

            await txn.cancel();
        });
    },
);

// A transaction() holds no state on the connection, so unlike beginTransaction() it works
// over every protocol, and every supported version of the server.
describe("transaction()", async () => {
    const john = new RecordId("person", "john");
    const mary = new RecordId("person", "mary");

    test("commits every query, and returns the result of each statement", async () => {
        const surreal = await createSurreal();
        await surreal.query(/* surql */ `DEFINE TABLE person SCHEMALESS`);

        const results = await surreal.transaction<[Person, Person, Person[]]>([
            surreal.create<Person>(john).content({ name: "John" }),
            surql`CREATE ONLY ${mary} SET name = ${"Mary"}`,
            surreal.select<Person>(new Table("person")),
        ]);

        // One result per statement, and none for the BEGIN and COMMIT around them
        expect(results).toHaveLength(3);
        expect(results[0]).toMatchObject({ name: "John" });
        expect(results[1]).toMatchObject({ name: "Mary" });
        expect(results[2].map((p) => p.name).sort()).toEqual(["John", "Mary"]);

        expect(await surreal.select<Person>(john)).toMatchObject({ name: "John" });
        expect(await surreal.select<Person>(mary)).toMatchObject({ name: "Mary" });
    });

    test("results are positional per statement, not per input", async () => {
        const surreal = await createSurreal();

        const results = await surreal.transaction<[1, 2, 3]>(["1; 2", "3"]);

        expect(results).toEqual([1, 2, 3]);
    });

    test("statements can see what the statements before them did", async () => {
        const surreal = await createSurreal();

        const [, , total] = await surreal.transaction<[unknown, unknown, number]>([
            "CREATE counter:a SET n = 1",
            "CREATE counter:b SET n = 2",
            "math::sum((SELECT VALUE n FROM counter))",
        ]);

        expect(total).toBe(3);
    });

    test("an empty list does nothing", async () => {
        const surreal = await createSurreal();

        expect(await surreal.transaction([])).toEqual([]);
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

        await surreal.transaction(["RETURN 1"]);

        expect(events.filter((e) => e.type === "query" && e.phase === "before")).toHaveLength(1);
    });

    test("uses the session it was called on", async () => {
        const surreal = await createSurreal();
        await surreal.set("who", "default");

        expect(await surreal.transaction<[string]>(["$who"])).toEqual(["default"]);
    });

    test.if(SURREAL_PROTOCOL === "http")(
        "works where beginTransaction() is not supported",
        async () => {
            const surreal = await createSurreal();

            await expect(surreal.beginTransaction()).rejects.toBeInstanceOf(
                UnsupportedFeatureError,
            );
            expect(await surreal.transaction<[1]>(["1"])).toEqual([1]);
        },
    );

    describe("failure", () => {
        test("rolls back every query, and throws the error which made it fail", async () => {
            const surreal = await createSurreal();
            await surreal.query(/* surql */ `DEFINE TABLE person SCHEMALESS`);

            // The statements on either side of the failure are reported as not executed. The
            // one before it comes first, so the first error to arrive is not the cause.
            const promise = surreal.transaction([
                "CREATE person:before SET name = 'Before'",
                "THROW 'boom'",
                "CREATE person:after SET name = 'After'",
            ]);

            await expect(promise).rejects.toBeInstanceOf(ServerError);
            await expect(promise).rejects.toThrow("boom");

            const error = await promise.catch((e: unknown) => e);

            expect(error).not.toBeInstanceOf(QueryError);
            expect(await surreal.select<Person>(new Table("person"))).toEqual([]);
        });

        test("throws the failure when it is the first statement", async () => {
            const surreal = await createSurreal();

            await expect(
                surreal.transaction(["THROW 'boom'", "CREATE person:after", "CREATE person:more"]),
            ).rejects.toThrow("boom");
        });

        test("throws the failure when it is the last statement", async () => {
            const surreal = await createSurreal();

            await expect(
                surreal.transaction(["CREATE person:before", "CREATE person:more", "THROW 'boom'"]),
            ).rejects.toThrow("boom");
        });

        test("throws the failure of a constraint, and keeps everything which was there", async () => {
            const surreal = await createSurreal();
            await surreal.query(/* surql */ `
                DEFINE TABLE person SCHEMALESS;
                DEFINE INDEX unique_name ON person FIELDS name UNIQUE;
                CREATE person:john SET name = 'John';
            `);

            const promise = surreal.transaction([
                "CREATE person:mary SET name = 'Mary'",
                "CREATE person:duplicate SET name = 'John'",
                "CREATE person:jane SET name = 'Jane'",
            ]);

            await expect(promise).rejects.toBeInstanceOf(ServerError);
            await expect(promise).rejects.toThrow("already contains");

            const people = await surreal.select<Person>(new Table("person"));

            expect(people.map((p) => p.name)).toEqual(["John"]);
        });

        test("throws an error in the request as it is", async () => {
            const surreal = await createSurreal();

            await expect(surreal.transaction(["1", "SEL ECT oops"])).rejects.toBeInstanceOf(
                ServerError,
            );
        });

        test("the connection is usable afterwards", async () => {
            const surreal = await createSurreal();

            await expect(surreal.transaction(["THROW 'boom'"])).rejects.toThrow("boom");

            expect(await surreal.transaction<[1]>(["1"])).toEqual([1]);
            expect(await surreal.query<[2]>("RETURN 2")).toEqual([2]);
        });
    });

    describe("queries which are not allowed", () => {
        test.each(["BEGIN", "COMMIT", "CANCEL", "BEGIN; CREATE person; COMMIT;"])(
            "%p is rejected before anything is sent",
            async (statement) => {
                const surreal = await createSurreal();
                await surreal.query(/* surql */ `DEFINE TABLE person SCHEMALESS`);

                const promise = surreal.transaction(["CREATE person:first", statement]);

                await expect(promise).rejects.toBeInstanceOf(ExpressionError);
                await expect(promise).rejects.toThrow(
                    /queries\[1\] contains a (BEGIN|COMMIT|CANCEL)/,
                );

                expect(await surreal.select<Person>(new Table("person"))).toEqual([]);
            },
        );

        test("a RETURN which would end the transaction early is rejected", async () => {
            const surreal = await createSurreal();
            await surreal.query(/* surql */ `DEFINE TABLE person SCHEMALESS`);

            await expect(
                surreal.transaction(["CREATE person:a", "RETURN 1", "CREATE person:b"]),
            ).rejects.toThrow(/queries\[1\] contains a RETURN statement/);

            expect(await surreal.select<Person>(new Table("person"))).toEqual([]);
        });

        test("a RETURN last is fine", async () => {
            const surreal = await createSurreal();

            expect(
                await surreal.transaction<[unknown, number]>(["CREATE person:a", "RETURN 7"]),
            ).toEqual([expect.anything(), 7]);
        });

        test("the keywords in strings are fine", async () => {
            const surreal = await createSurreal();

            const [created] = await surreal.transaction<[{ text: string }]>([
                "CREATE ONLY note SET text = 'BEGIN; COMMIT; CANCEL; RETURN 1;'",
            ]);

            expect(created.text).toBe("BEGIN; COMMIT; CANCEL; RETURN 1;");
        });

        test("two queries binding the same parameter are rejected, naming both", async () => {
            const surreal = await createSurreal();

            await expect(
                surreal.transaction([
                    new BoundQuery("$id", { id: 1 }),
                    new BoundQuery("$id", { id: 2 }),
                ]),
            ).rejects.toThrow(/'\$id' is bound by both queries\[0\] and queries\[1\]/);
        });

        test("something which is not an array is rejected", async () => {
            const surreal = await createSurreal();

            await expect(surreal.transaction("RETURN 1" as never)).rejects.toThrow(
                "transaction() expects an array of queries",
            );
        });
    });
});

// What the server reports for a failed transaction, and how a conflict is told apart from
// other failures, is only structured as of SurrealDB 3.
describe.if(is3x)("transaction() on SurrealDB 3", async () => {
    // Raised with THROW, which reports a generic server error rather than the structured
    // conflict, so these tests opt into the message based predicate which servers older than
    // 3.1.0 would need.
    const conflictRetry = (extra: Partial<RetryOptions> = {}): RetryOptions => ({
        enabled: true,
        attempts: 5,
        retryDelay: 1,
        retryDelayMax: 5,
        retryDelayMultiplier: 2,
        retryDelayJitter: 0,
        retryable: (error) => error instanceof ServerError && error.message.includes("conflict"),
        ...extra,
    });

    test("throws the specific kind of error, as a query would", async () => {
        const surreal = await createSurreal();

        const error = await surreal
            .transaction(["CREATE person:a", "THROW 'boom'", "CREATE person:b"])
            .catch((e: unknown) => e);

        expect(error).toBeInstanceOf(ThrownError);
        expect((error as ThrownError).message).toBe("An error occurred: boom");
    });

    test("throws an error of the request as the specific kind it is", async () => {
        const surreal = await createSurreal();

        await expect(surreal.transaction(["1", "SEL ECT oops"])).rejects.toBeInstanceOf(
            ValidationError,
        );
    });

    test("a RETURN ends a transaction early, which is why transaction() does not allow one", async () => {
        const surreal = await createSurreal();
        await surreal.query(/* surql */ `DEFINE TABLE person SCHEMALESS`);

        // The statements after the RETURN are skipped, yet this still commits
        const responses = await surreal
            .query("BEGIN; CREATE person:a; RETURN 1; CREATE person:b; COMMIT;")
            .responses();

        expect(responses.every((r) => r.success)).toBeTrue();

        const people = await surreal.select<Person>(new Table("person"));

        expect(people.map((p) => p.id.id)).toEqual(["a"]);
    });

    describe("retry", () => {
        test("is off by default", async () => {
            const surreal = await createSurreal();
            let asked = 0;

            await expect(
                surreal.transaction(["THROW 'read or write conflict'"], {
                    retry: { ...conflictRetry(), enabled: false, retryable: () => !!asked++ },
                }),
            ).rejects.toThrow("conflict");

            expect(asked).toBe(0);
        });

        test("replays the transaction while the error is retryable, then throws it", async () => {
            const surreal = await createSurreal();
            const seen: unknown[] = [];

            const promise = surreal.transaction(
                ["CREATE person:a", "THROW 'read or write conflict'", "CREATE person:b"],
                {
                    retry: conflictRetry({
                        attempts: 2,
                        retryable: (error) => {
                            seen.push(error);
                            return true;
                        },
                    }),
                },
            );

            await expect(promise).rejects.toThrow("read or write conflict");

            // Asked about the first attempt and each of the two retries, and each time about
            // the error which made the transaction fail, not one of those it caused.
            expect(seen).toHaveLength(3);
            for (const error of seen) {
                expect(error).toBeInstanceOf(ThrownError);
            }
        });

        test("does not retry an error which is not retryable", async () => {
            const surreal = await createSurreal();
            let asked = 0;

            await expect(
                surreal.transaction(["THROW 'boom'"], {
                    retry: conflictRetry({
                        retryable: (error) => {
                            asked++;
                            return (
                                error instanceof ServerError && error.message.includes("conflict")
                            );
                        },
                    }),
                }),
            ).rejects.toThrow("boom");

            expect(asked).toBe(1);
        });

        test("uses the retry configured on the connection", async () => {
            const { surreal, connect } = await createIdleSurreal();
            let asked = 0;

            await connect({
                retry: conflictRetry({
                    attempts: 1,
                    retryable: () => {
                        asked++;
                        return true;
                    },
                }),
            });

            await expect(surreal.transaction(["THROW 'boom'"])).rejects.toThrow("boom");

            // The first attempt and one retry
            expect(asked).toBe(2);
        });

        test("can turn off the retry configured on the connection", async () => {
            const { surreal, connect } = await createIdleSurreal();
            let asked = 0;

            await connect({
                retry: conflictRetry({
                    retryable: () => {
                        asked++;
                        return true;
                    },
                }),
            });

            await expect(surreal.transaction(["THROW 'boom'"], { retry: false })).rejects.toThrow(
                "boom",
            );

            expect(asked).toBe(0);
        });
    });

    describe("conflicts", () => {
        // Each updates the same record, and stays open long enough for the other to as well
        const increment = ["UPDATE counter:c SET n += 1", "SLEEP 300ms"];

        async function connections() {
            const [first, second] = await Promise.all([createSurreal(), createSurreal()]);
            await first.query(/* surql */ `CREATE counter:c SET n = 0`);

            return { first, second };
        }

        const counter = async (surreal: Awaited<ReturnType<typeof createSurreal>>) =>
            surreal.select<{ n: number }>(new RecordId("counter", "c"));

        test("without retry, the loser throws the conflict rather than a consequence of it", async () => {
            const { first, second } = await connections();

            const settled = await Promise.allSettled([
                first.transaction(increment),
                second.transaction(increment),
            ]);

            const losers = settled.filter((s) => s.status === "rejected");

            expect(losers).toHaveLength(1);

            // The error of the loser is the conflict, which the COMMIT reports last, and not
            // the error of an update which was rolled back as a consequence of it.
            const reason = (losers[0] as PromiseRejectedResult).reason;

            expect(reason).toBeInstanceOf(QueryError);
            expect((reason as QueryError).isTransactionConflict).toBeTrue();

            expect((await counter(first))?.n).toBe(1);
        });

        test("with retry, the loser is replayed and both go through", async () => {
            const { first, second } = await connections();
            const options: TransactionOptions = {
                retry: { enabled: true, retryDelay: 1, retryDelayMax: 10, attempts: 10 },
            };

            await Promise.all([
                first.transaction(increment, options),
                second.transaction(increment, options),
            ]);

            expect((await counter(first))?.n).toBe(2);
        });
    });
});
