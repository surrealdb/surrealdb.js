/**
 * Negotiating the `shaped` format, and reading the blocks a connection on it carries: the
 * subprotocol is offered alone, a server which does not know it sends the connection back to the
 * CBOR ladder, and the shapes a stream announces hold for the frames which follow.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Encoded } from "@surrealdb/cbor";
import { ShapedCodec } from "@surrealdb/sqon";
import { BoundQuery, WebSocketEngine } from "surrealdb";
import { MockSocket, mockContext, mockState } from "./__helpers__/mock-socket";
import {
    batchMessage,
    Fixed,
    Kind,
    row,
    shapeMessage,
    taggedByteString,
} from "./sqon/codecs/__helpers__/shaped.ts";

const shaped = new ShapedCodec({});

/** A block of rows of one `n: int` column, announcing the shape under id 1 */
function numbers(values: bigint[], announce = true): Uint8Array {
    const shape = { fixedSize: 8, columns: [{ name: "n", kind: Kind.Int, slot: 0 }] };
    const rows = values.map((n) => row({ fixed: new Fixed(8).i64(0, n).bytes }));

    return taggedByteString(
        new Uint8Array([1, ...(announce ? shapeMessage(1, shape) : []), ...batchMessage(1, rows)]),
    );
}

describe("negotiating shaped over WebSocket", () => {
    let engine: WebSocketEngine | undefined;

    beforeEach(() => MockSocket.reset());

    afterEach(async () => {
        await engine?.close();
        engine = undefined;
        MockSocket.reset();
    });

    async function open(options: { shaped?: boolean; streaming?: boolean } = {}) {
        const { shaped: asks = true, streaming = false } = options;
        const context = mockContext({ streaming, shaped: asks });
        if (asks) {
            context.codecs = { ...context.codecs, cbor2: shaped, shaped };
        }

        engine = new WebSocketEngine(context);
        const connected = new Promise<void>((resolve) => {
            const unsubscribe = engine?.subscribe("connected", () => {
                unsubscribe?.();
                resolve();
            });
        });

        engine.open(mockState());
        await connected;

        return { engine, socket: MockSocket.current };
    }

    test("offers shaped alone, never beside cbor", async () => {
        MockSocket.picks = "shaped";
        const { socket } = await open();

        // The server picks the first of ITS list which the client offered, and shaped is last
        // there, so offering it beside cbor would settle on cbor
        expect(MockSocket.sockets[0]?.offered).toEqual(["shaped"]);
        expect(socket.protocol).toBe("shaped");
    });

    test("falls back to the cbor ladder when the server does not know the name", async () => {
        MockSocket.knows = ["cbor.2", "cbor"];
        MockSocket.picks = "cbor.2";
        const { socket } = await open();

        expect(MockSocket.sockets.map((s) => s.offered)).toEqual([["shaped"], ["cbor.2", "cbor"]]);
        expect(socket.protocol).toBe("cbor.2");
    });

    test("does not offer shaped at all when the connection was not told to ask", async () => {
        const { socket } = await open({ shaped: false });

        expect(MockSocket.sockets[0]?.offered).not.toContain("shaped");
        expect(socket.protocol).toBe("cbor");
    });

    test("a block in a response decodes to its rows", async () => {
        MockSocket.picks = "shaped";
        const { engine } = await open();

        MockSocket.handler = (sock, request) => {
            sock.respondRaw(
                shaped.encode({
                    id: request.id,
                    result: new Encoded(numbers([1n, 2n, 3n])),
                }),
            );
        };

        const result = await engine.send({ method: "query", params: ["SELECT 1"] });
        expect(result).toEqual([{ n: 1 }, { n: 2 }, { n: 3 }]);
    });

    test("a shape announced in one stream frame holds for the frames after it", async () => {
        MockSocket.picks = "shaped";
        const { engine } = await open({ streaming: true });

        MockSocket.handler = (sock, request) => {
            if (request.method !== "query_stream") return;

            const frame = (result: unknown) =>
                queueMicrotask(() => sock.respondRaw(shaped.encode({ id: request.id, result })));

            frame({ stream: "begin", statements: 1 });
            // The first frame announces the shape; the second names it and announces nothing,
            // which only reads because the scope of one stream outlives its frames
            frame({ stream: "rows", index: 0, values: new Encoded(numbers([1n, 2n])) });
            frame({ stream: "rows", index: 0, values: new Encoded(numbers([3n], false)) });
            frame({ stream: "finished", index: 0, time: "1ms", type: "other", single: false });
            frame({ stream: "end", results: 1, time: "1ms" });
        };

        const chunks: unknown[] = [];
        for await (const chunk of engine.query(new BoundQuery("SELECT n FROM thing"), undefined)) {
            chunks.push(chunk.result);
        }

        expect(chunks[0]).toEqual([{ n: 1 }, { n: 2 }]);
        expect(chunks[1]).toEqual([{ n: 3 }]);
    });

    test("a response which carries no block is read as it always was", async () => {
        MockSocket.picks = "shaped";
        const { engine } = await open();

        MockSocket.handler = (sock, request) => {
            sock.respond({ id: request.id, result: { ok: true } });
        };

        const result: unknown = await engine.send({ method: "ping", params: [] });
        expect(result).toEqual({ ok: true });
    });
});
