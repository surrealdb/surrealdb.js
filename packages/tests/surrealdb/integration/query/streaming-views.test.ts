import { describe, expect, test } from "bun:test";
import { RecordId, type Surreal, Table, ThrownError } from "surrealdb";
import { createSurreal, SURREAL_PROTOCOL, serverStreams } from "../__helpers__";

/**
 * `rows()` and `statements()` read a query as a stream. They are the same answer as `collect()`,
 * delivered as it arrives where the server can, so most of what is checked here is that, and the
 * rest is what only a real stream can show: that the first rows precede the end of the query, and
 * that leaving one stops it.
 *
 * What depends on a stream actually being streamed is asserted only against a server which
 * streams, and every other assertion holds either way.
 */
describe.if(SURREAL_PROTOCOL === "ws")("rows() and statements()", () => {
    const RECORDS = 120;

    async function seeded(options: { streaming?: boolean } = {}): Promise<Surreal> {
        const surreal = await createSurreal({ driverOptions: options });

        await surreal.insert(
            Array.from({ length: RECORDS }, (_, index) => ({
                id: new RecordId("wide", index + 1),
                n: index + 1,
            })),
        );

        return surreal;
    }

    const MULTI = `
        SELECT * FROM wide ORDER BY id;
        RETURN 42;
        SELECT count() FROM wide GROUP ALL;
        SELECT * FROM ONLY wide ORDER BY id LIMIT 1;
    `;

    test("are the rows collect() returns, whether or not the driver streams", async () => {
        await seeded();

        // Two connections to the one database: one which streams, and one configured not to.
        for (const streaming of [true, false]) {
            const surreal = await createSurreal({ driverOptions: { streaming } });

            const collected = await surreal.query(MULTI).collect();
            const viaRows: unknown[] = [];

            for await (const row of surreal.query(MULTI).rows()) viaRows.push(row);

            // collect() keeps statements apart; rows() flattens them, and a single value is one row.
            const expected = collected.flatMap((statement) =>
                Array.isArray(statement) ? statement : [statement],
            );

            expect(viaRows).toEqual(expected);
            expect(viaRows).toHaveLength(RECORDS + 1 + 1 + 1);
        }
    });

    test("statements() are the statements collect() returns", async () => {
        const surreal = await seeded();

        const collected = await surreal.query(MULTI).collect();
        const statements = [];

        for await (const statement of surreal.query(MULTI).statements()) {
            statements.push(statement);
        }

        expect(statements.map((statement) => statement.index)).toEqual([0, 1, 2, 3]);
        expect(statements.map((statement) => statement.value)).toEqual(collected);
        expect(statements.map((statement) => statement.single)).toEqual([false, true, false, true]);

        for (const statement of statements) {
            expect(statement.type).toBe("other");
            expect(statement.stats?.duration).toBeDefined();
        }
    });

    test("a statement which is NONE is no row, but is a statement", async () => {
        const surreal = await seeded();
        const sql = "LET $n = 1; SELECT * FROM wide LIMIT 2;";

        const viaRows: unknown[] = [];

        for await (const row of surreal.query(sql).rows()) viaRows.push(row);

        expect(viaRows).toHaveLength(2);

        const statements = [];

        for await (const statement of surreal.query(sql).statements()) {
            statements.push(statement);
        }

        expect(statements.map((statement) => [statement.index, statement.single])).toEqual([
            [0, true],
            [1, false],
        ]);
        expect(statements[0]?.value).toBeUndefined();
    });

    test("the first rows arrive while the query is still running", async () => {
        if (!(await serverStreams())) return;

        const surreal = await seeded();
        const started = Bun.nanoseconds();
        let firstRow: number | undefined;

        for await (const _ of surreal.query("SELECT * FROM wide; SLEEP 800ms;").rows()) {
            firstRow ??= Bun.nanoseconds();
        }

        const done = Bun.nanoseconds();

        // The rows are not held behind the SLEEP which follows them.
        expect((done - (firstRow ?? done)) / 1e6).toBeGreaterThan(500);
        expect(((firstRow ?? done) - started) / 1e6).toBeLessThan(500);
    });

    test("a failing statement throws after the rows which preceded it", async () => {
        const surreal = await seeded();
        const seen: unknown[] = [];
        let thrown: unknown;

        try {
            for await (const row of surreal
                .query(`SELECT * FROM wide LIMIT 3; THROW "nope"; SELECT * FROM wide LIMIT 2`)
                .rows()) {
                seen.push(row);
            }
        } catch (error) {
            thrown = error;
        }

        expect(seen).toHaveLength(3);
        expect(thrown).toBeInstanceOf(ThrownError);
        expect((thrown as Error).message).toContain("nope");

        // And the connection is not left in the middle of it.
        expect(await surreal.query("RETURN 1").collect()).toEqual([1]);
    });

    test("statements() yields what was final, then throws", async () => {
        const surreal = await seeded();
        const seen: number[] = [];

        const attempt = (async () => {
            for await (const statement of surreal
                .query(`SELECT * FROM wide LIMIT 3; THROW "nope"; RETURN 1`)
                .statements()) {
                seen.push(statement.index);
            }
        })();

        await expect(attempt).rejects.toBeInstanceOf(ThrownError);
        expect(seen).toEqual([0]);
    });

    test("leaving part way stops the query, and the connection answers at once", async () => {
        if (!(await serverStreams())) return;

        const surreal = await seeded();
        const started = Bun.nanoseconds();

        for await (const _ of surreal.query("SELECT * FROM wide; SLEEP 30s;").rows()) break;

        // Not the 30 seconds the query would have run for.
        expect((Bun.nanoseconds() - started) / 1e6).toBeLessThan(5_000);
        expect(await surreal.query("RETURN 1").collect()).toEqual([1]);
    });

    test("leaving while a read is parked on the server lets go at once", async () => {
        if (!(await serverStreams())) return;

        const surreal = await seeded();
        const view = surreal.query("SLEEP 30s; RETURN 1;").rows();

        // Parked: the server has nothing to send until the SLEEP is over.
        const read = view.next();

        await Bun.sleep(100);

        const started = Bun.nanoseconds();
        const left = view.return();
        const outcome = await Promise.race([
            Promise.all([read, left]).then(() => "let go"),
            Bun.sleep(5_000).then(() => "still waiting"),
        ]);

        expect(outcome).toBe("let go");
        expect((Bun.nanoseconds() - started) / 1e6).toBeLessThan(2_000);
        expect(await surreal.query("RETURN 1").collect()).toEqual([1]);
    });

    test("leaving frees the server's slot, which only stopping the query does", async () => {
        if (!(await serverStreams())) return;

        const surreal = await seeded();

        // The server holds a connection to 32 streams at once, and a stream which was left but
        // not stopped is still running, so it still counts. Leaving more than that one after
        // another only works if each really stopped: the rest would be refused.
        for (let attempt = 0; attempt < 45; attempt++) {
            const view = surreal.query("SLEEP 30s; RETURN 1;").rows();

            // Parked on the server, as a stream is when its query has produced nothing yet.
            const read = view.next();

            await Bun.sleep(5);
            await view.return();
            await Promise.race([
                read,
                Bun.sleep(2_000).then(() => {
                    throw new Error(`the read of stream ${attempt} was not released`);
                }),
            ]);
            // Stopping is asked of the server, and takes a moment to be done.
            await Bun.sleep(15);
        }

        expect(await surreal.query("RETURN 1").collect()).toEqual([1]);
    });

    test("await using stops the query when the block is left", async () => {
        if (!(await serverStreams())) return;

        const surreal = await seeded();
        const started = Bun.nanoseconds();

        {
            await using rows = surreal.query("SELECT * FROM wide; SLEEP 30s;").rows();

            await rows.next();
        }

        expect((Bun.nanoseconds() - started) / 1e6).toBeLessThan(5_000);
        expect(await surreal.query("RETURN 1").collect()).toEqual([1]);
    });

    test("a signal abandons it, as it abandons the query it reads", async () => {
        const surreal = await seeded();
        const started = Bun.nanoseconds();

        const attempt = (async () => {
            for await (const _ of surreal
                .query("SLEEP 5s; RETURN 1;")
                .signal(AbortSignal.timeout(250))
                .rows()) {
                // Nothing arrives before the signal does.
            }
        })();

        await expect(attempt).rejects.toMatchObject({ name: "TimeoutError" });
        expect((Bun.nanoseconds() - started) / 1e6).toBeLessThan(3_000);
        expect(await surreal.query("RETURN 1").collect()).toEqual([1]);
    });

    test("a builder's rows() yields its records, and parse shapes them", async () => {
        const surreal = await seeded();

        const records: unknown[] = [];

        for await (const record of surreal.select(new Table("wide")).rows()) {
            records.push(record);
        }

        expect(records).toHaveLength(RECORDS);

        const ids: string[] = [];

        for await (const id of surreal
            .select<{ id: RecordId }>(new Table("wide"))
            .rows((record) => record.id.toString())) {
            ids.push(id);
        }

        expect(ids).toHaveLength(RECORDS);
        expect(ids[0]).toMatch(/^wide:/);
    });

    test("rows() inside a transaction streams, and the transaction commits what it wrote", async () => {
        const surreal = await seeded();
        const transaction = await surreal.beginTransaction();

        const updated: unknown[] = [];

        for await (const row of transaction.query("UPDATE wide SET seen = true").rows()) {
            updated.push(row);
        }

        // Read to the end first: committing while the query still runs commits a prefix.
        await transaction.commit();

        expect(updated).toHaveLength(RECORDS);

        const [seen] = await surreal
            .query("SELECT count() FROM wide WHERE seen = true GROUP ALL")
            .collect();

        expect(seen).toEqual([{ count: RECORDS }]);
    });

    test("rows keep statement order inside a transaction which is written in the query", async () => {
        const surreal = await seeded();

        // Inside BEGIN ... COMMIT the server sends the value of a statement after the rows of the
        // statements which follow it, once one has enough rows to be flushed. The rows are those
        // of collect(), in its order, whichever order the server sent them in.
        const sql = `
            BEGIN;
            SELECT VALUE n FROM ONLY wide:1;
            SELECT VALUE n FROM wide ORDER BY id;
            COMMIT;
        `;

        const collected = await surreal.query(sql).collect();
        const expected = collected.flatMap((statement) =>
            Array.isArray(statement) ? statement : statement === undefined ? [] : [statement],
        );

        const viaRows: unknown[] = [];

        for await (const row of surreal.query(sql).rows()) viaRows.push(row);

        expect(viaRows).toEqual(expected);
        expect(viaRows[0]).toBe(1);
        expect(viaRows).toHaveLength(1 + RECORDS);
    });

    test("reads asked for at once each take a row, in order, with done last", async () => {
        const surreal = await createSurreal();

        // Small, so that the reads which are asked for at once run past the end of each statement,
        // which is where reads which are not kept in order lose or repeat rows.
        await surreal.insert([1, 2, 3].map((n) => ({ id: new RecordId("tiny", n), n })));

        const view = surreal
            .query(
                "SELECT * FROM tiny ORDER BY id; LET $a = 1; SELECT * FROM tiny ORDER BY id DESC",
            )
            .rows();

        const results = await Promise.all(Array.from({ length: 8 }, () => view.next()));

        expect(
            results.map((result) => (result.done ? "done" : (result.value as { n: number }).n)),
        ).toEqual([1, 2, 3, 3, 2, 1, "done", "done"]);

        // And nothing turns up after it.
        expect(await view.next()).toEqual({ value: undefined, done: true });
    });

    test("leaving a read parked on the answer is not waited out, streaming or not", async () => {
        const surreal = await seeded();
        const view = surreal.query("SLEEP 3s; RETURN 1;").rows();
        const read = view.next();

        await Bun.sleep(100);

        const started = Bun.nanoseconds();
        const outcome = await Promise.race([
            Promise.all([read, view.return()]).then(() => "let go"),
            Bun.sleep(2_500).then(() => "still waiting"),
        ]);

        // On a server which does not stream, the answer is one request which `return()` cannot
        // reach: what frees the read is abandoning the request.
        expect(outcome).toBe("let go");
        expect((Bun.nanoseconds() - started) / 1e6).toBeLessThan(2_000);
        expect(await surreal.query("RETURN 1").collect()).toEqual([1]);
    });

    describe("a builder's rows()", () => {
        test("create, update, upsert, delete, insert and relate yield their records", async () => {
            const surreal = await seeded();

            const read = async (source: AsyncIterable<unknown>) => {
                const seen: unknown[] = [];

                for await (const row of source) seen.push(row);

                return seen;
            };

            const created = await read(surreal.create(new Table("made")).content({ n: 1 }).rows());
            expect(created).toHaveLength(1);
            expect(created[0]).toMatchObject({ n: 1 });

            const updated = await read(
                surreal.update(new Table("wide")).merge({ seen: true }).rows(),
            );
            expect(updated).toHaveLength(RECORDS);
            expect(updated[0]).toMatchObject({ seen: true });

            const upserted = await read(
                surreal.upsert(new RecordId("up", 1)).content({ n: 2 }).rows(),
            );
            expect(upserted).toHaveLength(1);
            expect(upserted[0]).toMatchObject({ n: 2 });

            const inserted = await read(
                surreal.insert(new Table("ins"), [{ n: 1 }, { n: 2 }, { n: 3 }]).rows(),
            );
            expect(inserted).toHaveLength(3);

            const related = await read(
                surreal
                    .relate(new RecordId("a", 1), new Table("knows"), new RecordId("b", 1))
                    .rows(),
            );
            expect(related.length).toBeGreaterThan(0);

            const deleted = await read(surreal.delete(new Table("ins")).rows());
            expect(deleted).toHaveLength(3);
        });

        test("parse shapes the records of each, as it does for select", async () => {
            const surreal = await seeded();

            const seen: number[] = [];

            for await (const n of surreal
                .update<{ n: number }>(new Table("wide"))
                .merge({ touched: true })
                .rows((record) => record.n)) {
                seen.push(n);
            }

            expect(seen).toHaveLength(RECORDS);
            expect(seen[0]).toBe(1);
        });
    });

    test("statements() in json mode makes single values JSON compatible too", async () => {
        const surreal = await seeded();

        const statements = [];

        for await (const statement of surreal
            .query("RETURN wide:1; SELECT * FROM wide ORDER BY id LIMIT 1")
            .json()
            .statements()) {
            statements.push(statement);
        }

        expect(statements[0]?.value).toBe("wide:1");
        expect(statements[1]?.value).toEqual([{ id: "wide:1", n: 1 }]);
    });

    test("json() rows are made JSON compatible", async () => {
        const surreal = await seeded();

        const [row] = await (async () => {
            const seen: unknown[] = [];

            for await (const value of surreal
                .query("SELECT * FROM wide ORDER BY id LIMIT 1")
                .json()
                .rows()) {
                seen.push(value);
            }

            return seen;
        })();

        expect(row).toEqual({ id: "wide:1", n: 1 });
    });
});
