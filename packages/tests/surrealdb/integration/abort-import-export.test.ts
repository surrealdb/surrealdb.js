import { describe, expect, test } from "bun:test";
import { createIdleSurreal, createSurreal, SURREAL_PROTOCOL } from "./__helpers__";

// Import and export travel over HTTP whichever protocol the connection uses, so these run on both

const PROMPT = 2000;

async function caught(promise: Promise<unknown>): Promise<unknown> {
    try {
        await promise;
    } catch (error) {
        return error;
    }

    throw new Error("Expected the promise to reject");
}

/** An upload which sends what it is given, one chunk at a time, and then stalls or ends. */
function upload(chunks: string[], options: { delay?: number; end?: boolean } = {}) {
    const encoder = new TextEncoder();
    const log: { cancelled?: unknown; sent: number } = { sent: 0 };

    const stream = new ReadableStream<Uint8Array>({
        async pull(controller) {
            if (log.sent < chunks.length) {
                if (options.delay) await Bun.sleep(options.delay);
                controller.enqueue(encoder.encode(chunks[log.sent++]));
                return;
            }

            if (options.end) {
                controller.close();
                return;
            }

            return new Promise(() => {});
        },
        cancel(reason) {
            log.cancelled = reason;
        },
    });

    return { stream, log };
}

async function populate(surreal: Awaited<ReturnType<typeof createSurreal>>) {
    // A few hundred rows. A server removes the data of a database asynchronously, and a 2.x server
    // refuses to define the next test's database again until it is done, so it must not be much.
    await surreal.query(
        /* surql */ `DEFINE TABLE person SCHEMALESS; CREATE |person:300| SET text = rand::string(64);`,
    );
}

/**
 * A `fetch` which takes its time to send a request, so that a request is in flight for as long as a
 * test needs, whatever the server is. Everything else about it is the real thing.
 */
function slowFetch(milliseconds: number): typeof fetch {
    return (async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
        await Bun.sleep(milliseconds);

        return fetch(input, init);
    }) as typeof fetch;
}

/** A connection whose import and export requests take a hundred milliseconds to be sent. */
async function connectSlow(options: { requestTimeout?: number } = {}) {
    const { surreal, connect } = await createIdleSurreal({
        driverOptions: { fetchImpl: slowFetch(100) },
    });

    await connect(options);

    return surreal;
}

describe.if(SURREAL_PROTOCOL === "ws" || SURREAL_PROTOCOL === "http")("export and signals", () => {
    test("an export is abandoned mid-flight with the reason of the signal", async () => {
        const surreal = await connectSlow();
        await populate(surreal);

        const reason = new Error("the client went away");
        const controller = new AbortController();
        setTimeout(() => controller.abort(reason), 20);

        const started = performance.now();
        const error = await caught(Promise.resolve(surreal.export().signal(controller.signal)));

        expect(error).toBe(reason);
        expect(performance.now() - started).toBeLessThan(PROMPT);

        // Nothing is left behind, and the same export is fine
        expect((await surreal.export()).length).toBeGreaterThan(1000);
    });

    test("an export abandoned the moment it is requested does not reach the server", async () => {
        const surreal = await createSurreal();
        await populate(surreal);

        const reason = new Error("the client went away");
        const controller = new AbortController();
        const exporting = Promise.resolve(surreal.export().signal(controller.signal));

        // Only microtasks have run, so no answer can have come back from the network yet
        await Promise.resolve();
        await Promise.resolve();
        controller.abort(reason);

        expect(await caught(exporting)).toBe(reason);
        expect((await surreal.export()).length).toBeGreaterThan(1000);
    });

    test("a timeout is reported as a TimeoutError", async () => {
        const surreal = await connectSlow();
        await populate(surreal);

        const error = (await caught(Promise.resolve(surreal.export().requestTimeout(20)))) as Error;

        expect(error.name).toBe("TimeoutError");
    });

    test("a signal which has aborted already requests nothing", async () => {
        const surreal = await createSurreal();
        const reason = new Error("never started");
        const controller = new AbortController();
        controller.abort(reason);

        expect(await caught(Promise.resolve(surreal.export().signal(controller.signal)))).toBe(
            reason,
        );
        expect(
            await caught(Promise.resolve(surreal.export().raw().signal(controller.signal))),
        ).toBe(reason);
    });

    test("a raw export can be abandoned while its body is being read", async () => {
        const surreal = await createSurreal();
        await populate(surreal);

        const reason = new Error("the client went away");
        const controller = new AbortController();
        const response = await surreal.export().raw().signal(controller.signal);
        const reader = (response.body as ReadableStream<Uint8Array>).getReader();

        // Reads some of it, as a consumer would, and then the request goes away
        await reader.read();
        controller.abort(reason);

        // What was left was released: reading carries on to the end or to the reason, and does
        // not hang. A body which had all arrived already is entitled to finish.
        const outcome = await Promise.race([
            (async () => {
                try {
                    for (;;) {
                        if ((await reader.read()).done) return "finished";
                    }
                } catch (error) {
                    return error;
                }
            })(),
            Bun.sleep(PROMPT).then(() => "hung"),
        ]);

        expect(outcome).not.toBe("hung");
        if (outcome !== "finished") expect(outcome).toBe(reason);
    });

    test("a request scope abandons an export with its signal", async () => {
        const surreal = await connectSlow();
        await populate(surreal);

        const reason = new Error("the request went away");
        const controller = new AbortController();
        setTimeout(() => controller.abort(reason), 20);

        expect(await caught(Promise.resolve(surreal.withSignal(controller.signal).export()))).toBe(
            reason,
        );
    });

    test("the connection's requestTimeout does not apply to an export", async () => {
        // Every request takes 100ms to be sent, which a limit of 20ms would not allow a query
        const surreal = await connectSlow({ requestTimeout: 20 });
        await surreal
            .query(/* surql */ `DEFINE TABLE person SCHEMALESS; CREATE |person:300|;`)
            .requestTimeout(0);

        expect((await surreal.export()).length).toBeGreaterThan(1000);
    });
});

describe.if(SURREAL_PROTOCOL === "ws" || SURREAL_PROTOCOL === "http")("import and signals", () => {
    test("a stream which is being uploaded is cancelled when the signal aborts", async () => {
        const surreal = await createSurreal();
        const source = upload(["OPTION IMPORT;\nDEFINE TABLE slow_import SCHEMALESS;\n"]);
        const reason = new Error("the client went away");
        const controller = new AbortController();

        setTimeout(() => controller.abort(reason), 200);

        const started = performance.now();
        const error = await caught(surreal.import(source.stream).signal(controller.signal));

        expect(error).toBe(reason);
        expect(performance.now() - started).toBeLessThan(PROMPT);

        // Nothing keeps reading from it, and it was told why
        expect(source.log.cancelled).toBe(reason);

        // The upload never finished, so there was nothing for the server to run
        const [info] = await surreal.query("INFO FOR DB").collect<[{ tables: object }]>();
        expect(Object.keys(info?.tables ?? {})).not.toContain("slow_import");

        // And the connection is fine
        expect(await surreal.query("RETURN 1").collect()).toEqual([1]);
    });

    test("a timeout expiring mid-upload is a TimeoutError, and releases the stream", async () => {
        const surreal = await createSurreal();
        const source = upload(["OPTION IMPORT;\nDEFINE TABLE slow_import SCHEMALESS;\n"]);

        const error = (await caught(surreal.import(source.stream).requestTimeout(150))) as Error;

        expect(error.name).toBe("TimeoutError");
        expect((source.log.cancelled as Error).name).toBe("TimeoutError");
    });

    test("a signal which has aborted already uploads nothing", async () => {
        const surreal = await createSurreal();
        const source = upload(["OPTION IMPORT;\nDEFINE TABLE never_imported SCHEMALESS;\n"], {
            end: true,
        });
        const reason = new Error("never started");
        const controller = new AbortController();
        controller.abort(reason);

        expect(await caught(surreal.import(source.stream).signal(controller.signal))).toBe(reason);

        // The stream was not touched: it is neither locked by an upload nor cancelled
        expect(source.stream.locked).toBe(false);
        expect(source.log.cancelled).toBeUndefined();

        const [info] = await surreal.query("INFO FOR DB").collect<[{ tables: object }]>();
        expect(Object.keys(info?.tables ?? {})).not.toContain("never_imported");
    });

    test("an import which is not aborted is applied as before", async () => {
        const surreal = await createSurreal();
        const controller = new AbortController();
        const source = upload(
            ["OPTION IMPORT;\nDEFINE TABLE kept SCHEMALESS;\n", "CREATE kept:1;\n"],
            {
                end: true,
            },
        );

        await surreal.import(source.stream).signal(controller.signal);

        expect(await surreal.select(new (await import("surrealdb")).Table("kept"))).toHaveLength(1);
    });

    test("the connection's requestTimeout does not apply to a slow upload", async () => {
        const { surreal, connect } = await createIdleSurreal();
        await connect({ requestTimeout: 100 });

        // Takes about 400ms, well over the limit which every query on the connection has
        const source = upload(
            [
                "OPTION IMPORT;\nDEFINE TABLE slow_but_fine SCHEMALESS;\n",
                "CREATE slow_but_fine:1;\n",
                "CREATE slow_but_fine:2;\n",
                "CREATE slow_but_fine:3;\n",
            ],
            { delay: 100, end: true },
        );

        await surreal.import(source.stream);

        const [rows] = await surreal.query("SELECT * FROM slow_but_fine").collect<[unknown[]]>();
        expect(rows).toHaveLength(3);
    });

    test("a request scope abandons an import with its signal", async () => {
        const surreal = await createSurreal();
        const source = upload(["OPTION IMPORT;\nDEFINE TABLE slow_import SCHEMALESS;\n"]);
        const reason = new Error("the request went away");
        const controller = new AbortController();

        setTimeout(() => controller.abort(reason), 150);

        expect(await caught(surreal.withSignal(controller.signal).import(source.stream))).toBe(
            reason,
        );
        expect(source.log.cancelled).toBe(reason);
    });
});
