import { describe, expect, test } from "bun:test";
import { type LiveMessage, type QueryChunk, RecordId, type Surreal, type Uuid } from "surrealdb";
import {
    createSurreal,
    getEngines,
    SURREAL_PASS,
    SURREAL_PORT,
    SURREAL_PROTOCOL,
    SURREAL_USER,
} from "../__helpers__";

/**
 * Query results are streamed from the server when both sides support it, and
 * buffered into a single response when they do not. Which of the two happened
 * is deliberately invisible, so every test here holds either way: what is under
 * test is that a streamed answer is the buffered answer, delivered piecewise.
 */
describe.if(SURREAL_PROTOCOL === "ws")("query streaming", () => {
    // Seeded explicitly rather than with a record range, whose bounds are not the same on every
    // server version this suite runs against.
    const RECORDS = 120;

    const MULTI = `
        SELECT * FROM wide ORDER BY id;
        RETURN 42;
        SELECT count() FROM wide GROUP ALL;
        SELECT * FROM ONLY wide ORDER BY id LIMIT 1;
    `;

    async function seeded() {
        const surreal = await createSurreal();

        await seed(surreal);

        return surreal;
    }

    async function seed(surreal: Surreal): Promise<void> {
        await surreal.insert(
            Array.from({ length: RECORDS }, (_, index) => ({
                id: new RecordId("wide", index + 1),
                n: index + 1,
            })),
        );
    }

    test("a streamed answer is the buffered answer", async () => {
        const streamed = await seeded();
        const buffered = await createSurreal({ driverOptions: { streaming: false } });

        expect(await streamed.query(MULTI).collect()).toEqual(
            await buffered.query(MULTI).collect(),
        );
    });

    test("the statistics and types of every statement survive", async () => {
        const surreal = await seeded();
        const responses = await surreal.query(MULTI).responses();

        expect(responses).toHaveLength(4);

        for (const response of responses) {
            expect(response.success).toBe(true);
            expect(response.stats?.duration).toBeDefined();
        }

        expect(responses[0]?.success && responses[0].result).toBeArrayOfSize(RECORDS);
        expect(responses[1]?.success && responses[1].result).toBe(42);
        expect(responses[2]?.success && responses[2].result).toEqual([{ count: RECORDS }]);
        expect(responses[3]?.success && responses[3].result).toHaveProperty("id");
    });

    test("frames rebuild the results the statements produced", async () => {
        const surreal = await seeded();
        const rebuilt: unknown[][] = [];
        const finished: number[] = [];

        for await (const frame of surreal.query(MULTI).stream()) {
            if (frame.isError()) throw frame.error;

            if (frame.isValue()) {
                rebuilt[frame.query] ??= [];
                rebuilt[frame.query]?.push(frame.value);
            }

            if (frame.isDone()) finished.push(frame.query);
        }

        // Statements are counted by their terminal frames, and each one is terminal once.
        expect(finished.sort()).toEqual([0, 1, 2, 3]);
        expect(rebuilt[0]).toBeArrayOfSize(RECORDS);
        expect(rebuilt[1]).toEqual([42]);
        expect(rebuilt[3]).toBeArrayOfSize(1);
    });

    test("a failing statement is reported without disturbing the others", async () => {
        const surreal = await seeded();
        const [first, second, third] = await surreal
            .query(`SELECT * FROM wide LIMIT 2; THROW "nope"; RETURN 7;`)
            .responses();

        expect(first?.success).toBe(true);
        expect(second?.success).toBe(false);
        expect(second?.success === false && second.error.message).toContain("nope");
        expect(third?.success).toBe(true);
    });

    test("a failure is the same failure either way", async () => {
        const FAILING = `SELECT * FROM wide LIMIT 1; THROW "nope"; CREATE wide:1;`;

        const streamed = await seeded();
        const buffered = await createSurreal({ driverOptions: { streaming: false } });

        const shape = (
            responses: Awaited<ReturnType<ReturnType<typeof streamed.query>["responses"]>>,
        ) =>
            responses.map((response) =>
                response.success
                    ? { success: true }
                    : {
                          success: false,
                          name: response.error.name,
                          kind: response.error.kind,
                          code: response.error.code,
                          message: response.error.message,
                      },
            );

        expect(shape(await streamed.query(FAILING).responses())).toEqual(
            shape(await buffered.query(FAILING).responses()),
        );
    });

    test("collecting a query which fails rejects rather than returning part of it", async () => {
        const surreal = await seeded();

        await expect(surreal.query(`SELECT * FROM wide; THROW "nope";`).collect()).rejects.toThrow(
            "nope",
        );
    });

    test("abandoning a query part way leaves the connection usable", async () => {
        const surreal = await seeded();

        for await (const frame of surreal.query("SELECT * FROM wide ORDER BY id").stream()) {
            if (frame.isValue()) break;
        }

        const [count] = await surreal.query("SELECT count() FROM wide GROUP ALL").collect();

        expect(count).toEqual([{ count: RECORDS }]);
    });

    test("results really are streamed in batches, when the server serves them that way", async () => {
        const chunks: QueryChunk<unknown>[] = [];
        const engines = await getEngines((diagnostic) => {
            if (diagnostic.type !== "query" || diagnostic.phase !== "progress") return;
            if (diagnostic.result.chunk) chunks.push(diagnostic.result.chunk);
        });

        const surreal = await createSurreal({ driverOptions: { engines } });

        await seed(surreal);

        chunks.length = 0;

        const [rows] = await surreal.query("SELECT * FROM wide ORDER BY id").collect();

        expect(rows).toBeArrayOfSize(RECORDS);
        expect(chunks.at(-1)?.kind).toBe("batched-final");

        if (await serverStreams()) {
            // The server ramps its batches, so a result this size arrives in several frames and
            // the rows reach the SDK before the statement is finished.
            expect(chunks.filter((chunk) => chunk.kind === "batched")).not.toBeEmpty();
            expect(chunks.length).toBeGreaterThan(2);
        } else {
            // Buffered: one response, one chunk carrying the whole statement.
            expect(chunks).toHaveLength(1);
        }
    });

    test("a live query registered through a query still delivers notifications", async () => {
        const surreal = await createSurreal();
        const writer = await createSurreal();

        await surreal.query("DEFINE TABLE thing").collect();

        const [id] = await surreal.query<[Uuid]>("LIVE SELECT * FROM thing").collect();
        const subscription = await surreal.liveOf(id);
        const received = new Promise<LiveMessage>((resolve) => {
            subscription.subscribe(resolve);
        });

        await writer.query("CREATE thing:1 SET x = 1").collect();

        const message = await received;

        expect(message.action).toBe("CREATE");
    });
});

let support: Promise<boolean> | undefined;

/**
 * Whether the server under test serves the streaming query method.
 *
 * Asked over a raw socket rather than through the SDK, whose whole point is to
 * make the difference invisible: a test which wants to know that streaming
 * actually happened cannot ask the thing it is testing.
 */
function serverStreams(): Promise<boolean> {
    support ??= probeQueryStream();
    return support;
}

async function probeQueryStream(): Promise<boolean> {
    const socket = new WebSocket(`ws://127.0.0.1:${SURREAL_PORT}/rpc`, "json");

    try {
        await new Promise<void>((resolve, reject) => {
            socket.addEventListener("open", () => resolve());
            socket.addEventListener("error", () =>
                reject(new Error("the probe could not connect")),
            );
        });

        await probeRequest(socket, {
            id: "probe-signin",
            method: "signin",
            params: [{ user: SURREAL_USER, pass: SURREAL_PASS }],
        });

        const answer = await probeRequest(socket, {
            id: "probe-stream",
            method: "query_stream",
            params: ["RETURN 1"],
        });

        // A server without the method answers the request with Method not found; one with it
        // answers with the first frame of the stream instead.
        return answer.error?.code !== -32601;
    } finally {
        socket.close();
    }
}

interface ProbeResponse {
    id?: string;
    result?: unknown;
    error?: { code?: number; message?: string };
}

function probeRequest(
    socket: WebSocket,
    body: { id: string; method: string; params: unknown[] },
): Promise<ProbeResponse> {
    return new Promise<ProbeResponse>((resolve, reject) => {
        const timer = setTimeout(() => {
            socket.removeEventListener("message", listener);
            reject(new Error(`the probe request ${body.id} went unanswered`));
        }, 10_000);

        const listener = (event: MessageEvent) => {
            const response = JSON.parse(event.data as string) as ProbeResponse;

            if (response.id !== body.id) return;

            clearTimeout(timer);
            socket.removeEventListener("message", listener);
            resolve(response);
        };

        socket.addEventListener("message", listener);
        socket.send(JSON.stringify(body));
    });
}
