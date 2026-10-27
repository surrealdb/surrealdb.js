import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { CborCodec, Surreal, U8, U64, WebSocketEngine } from "surrealdb";
import { MockSocket, mockContext, mockState } from "./__helpers__/mock-socket";

const cbor = new CborCodec({});
const cbor2 = new CborCodec({ version: 2 });

const hex = (bytes: Uint8Array) => Buffer.from(bytes).toString("hex");

describe("cbor.2 over WebSocket", () => {
    let engine: WebSocketEngine | undefined;

    beforeEach(() => MockSocket.reset());

    afterEach(async () => {
        await engine?.close();
        engine = undefined;
        MockSocket.reset();
    });

    async function open(codecs: { cbor2?: CborCodec } = { cbor2 }) {
        const context = mockContext({ streaming: false });
        context.codecs = { ...context.codecs, ...codecs };

        engine = new WebSocketEngine(context);
        const connected = new Promise<void>((resolve) => {
            const unsubscribe = engine?.subscribe("connected", () => {
                unsubscribe?.();
                resolve();
            });
        });

        engine.open(mockState());
        await connected;

        MockSocket.handler = (socket, request) => {
            socket.respond({ id: request.id, result: request.params?.[0] });
        };

        return { engine, socket: MockSocket.current };
    }

    /** Sends a value to be echoed, and returns the bytes it was sent as and what came back */
    async function echo(engine: WebSocketEngine, socket: MockSocket, value: unknown) {
        const result = await engine.send({ method: "echo", params: [value] });
        return { result, request: socket.requests.at(-1) };
    }

    test("offers cbor.2 first, then cbor", async () => {
        const { socket } = await open();

        expect(socket.offered).toEqual(["cbor.2", "cbor"]);
    });

    test("offers only cbor without a cbor.2 codec", async () => {
        const { socket } = await open({ cbor2: undefined });

        expect(socket.offered).toEqual(["cbor"]);
    });

    test("offers cbor alone where the runtime will not open a socket offering both", async () => {
        MockSocket.refusesLists = true;
        const { engine, socket } = await open();

        expect(MockSocket.sockets.map((s) => s.offered)).toEqual([["cbor.2", "cbor"], ["cbor"]]);
        expect(socket.protocol).toBe("cbor");

        // Over which sized numbers go widened
        const { result } = await echo(engine, socket, new U8(5));
        expect(result).toBe(5);
    });

    test("speaks cbor.2 when the server picks it", async () => {
        MockSocket.picks = "cbor.2";
        const { engine, socket } = await open();

        const { result, request } = await echo(engine, socket, new U8(5));

        // The mock server read it as cbor.2, so the width went over the wire
        expect(request?.params?.[0]).toBeInstanceOf(U8);
        expect(result).toBeInstanceOf(U8);
        expect((result as U8).value).toBe(5);
    });

    test("speaks plain cbor when the server picks it, widening the sized numbers", async () => {
        MockSocket.picks = "cbor";
        const { engine, socket } = await open();

        const { result, request } = await echo(engine, socket, new U64(2n ** 64n - 1n));

        expect(String(request?.params?.[0])).toBe("18446744073709551615");
        expect(result).not.toBeInstanceOf(U64);
    });
});

describe("cbor.2 over HTTP", () => {
    interface Seen {
        contentType: string | undefined;
        accept: string | undefined;
        body: Uint8Array;
    }

    /** A server which answers in cbor.2 when asked to and `speaks` it, echoing `query` params */
    function server(speaks: boolean) {
        const seen: Seen[] = [];

        const fetchImpl = (async (_input: string | URL | Request, init: RequestInit = {}) => {
            const headers = init.headers as Record<string, string>;
            const body = init.body as Uint8Array;
            const v2In = /v=2/.test(headers["Content-Type"] ?? "");
            const v2Out = speaks && /v=2/.test(headers.Accept ?? "");

            seen.push({ contentType: headers["Content-Type"], accept: headers.Accept, body });

            const request = (v2In ? cbor2 : cbor).decode<{
                id: string;
                method: string;
                params?: unknown[];
            }>(body);
            // A query answers with the `v` it was given
            const vars = request.params?.[1] as { v?: unknown } | undefined;
            const result =
                request.method === "version"
                    ? "surrealdb-4.0.0"
                    : request.method === "query"
                      ? [{ status: "OK", time: "1ms", result: vars?.v }]
                      : null;

            return new Response((v2Out ? cbor2 : cbor).encode({ id: request.id, result }), {
                status: 200,
                headers: {
                    "Content-Type": v2Out ? "application/cbor; v=2" : "application/cbor",
                },
            });
        }) as typeof fetch;

        return { fetchImpl, seen };
    }

    async function connect(
        speaks: boolean,
        options: ConstructorParameters<typeof Surreal>[0] = {},
    ) {
        const mock = server(speaks);
        const db = new Surreal({ fetchImpl: mock.fetchImpl, ...options });
        await db.connect("http://localhost:8000/rpc", { namespace: "test", database: "test" });
        return { db, seen: mock.seen };
    }

    test("asks for cbor.2, and sends it once the server has answered in it", async () => {
        const { db, seen } = await connect(true);

        // The version request on connecting is the first, in plain cbor
        expect(seen[0]?.contentType).toBe("application/cbor");
        expect(seen[0]?.accept).toBe("application/cbor; v=2");

        const [result] = await db.query("RETURN $v", { v: new U8(5) }).collect();
        const last = seen.at(-1);

        expect(last?.contentType).toBe("application/cbor; v=2");
        expect(hex(last?.body ?? new Uint8Array())).toContain("d8b505");
        expect(result).toBeInstanceOf(U8);

        await db.close();
    });

    test("stays on plain cbor with a server which answers in it", async () => {
        const { db, seen } = await connect(false);

        const [result] = await db.query("RETURN $v", { v: new U8(5) }).collect();
        const last = seen.at(-1);

        expect(last?.contentType).toBe("application/cbor");
        expect(hex(last?.body ?? new Uint8Array())).not.toContain("d8b5");
        expect(result).toBe(5);

        await db.close();
    });

    test("does not ask for cbor.2 when a custom cbor codec is given without a cbor.2 one", async () => {
        const { db, seen } = await connect(true, {
            codecs: { cbor: () => new CborCodec({}) },
        });

        expect(seen.every((request) => request.accept === "application/cbor")).toBe(true);

        await db.close();
    });
});
