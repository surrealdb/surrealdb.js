import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { WebSocketEngine } from "surrealdb";
import { FakeClock } from "./__helpers__/fake-clock";
import { MockSocket, mockContext, mockState } from "./__helpers__/mock-socket";

const START = new Date("2030-01-01T00:00:00Z");

describe("WebSocket keepalive ping-pong", () => {
    let clock: FakeClock;
    let engine: WebSocketEngine | undefined;

    beforeEach(() => {
        clock = new FakeClock(START).install();
        MockSocket.reset();
    });

    afterEach(async () => {
        clock.uninstall();
        await engine?.close();
        engine = undefined;
        MockSocket.reset();
    });

    async function flush(): Promise<void> {
        for (let i = 0; i < 50; i++) await Promise.resolve();
    }

    async function advance(ms: number): Promise<void> {
        await clock.advance(ms, flush);
    }

    async function openConnectedEngine(): Promise<{ engine: WebSocketEngine; socket: MockSocket }> {
        const context = mockContext({ streaming: false });
        const opened = new WebSocketEngine(context);
        engine = opened;

        const connected = new Promise<void>((resolve) => {
            const unsubscribe = opened.subscribe("connected", () => {
                unsubscribe();
                resolve();
            });
        });

        opened.open(mockState(false));

        // Advance to run open microtask
        await flush();
        await connected;

        return { engine: opened, socket: MockSocket.current };
    }

    test("sends a ping every 3 seconds", async () => {
        const { socket } = await openConnectedEngine();

        expect(socket.requestsFor("ping").length).toBe(0);

        // Advance 3 seconds
        await advance(3_000);
        expect(socket.requestsFor("ping").length).toBe(1);

        // Advance another 3 seconds
        await advance(3_000);
        expect(socket.requestsFor("ping").length).toBe(2);
    });

    test("stays connected when pong responses arrive", async () => {
        const { socket } = await openConnectedEngine();

        MockSocket.handler = (sock, req) => {
            if (req.method === "ping") {
                sock.respond({ id: req.id, result: null });
            }
        };

        // Advance through multiple ping cycles
        for (let i = 0; i < 5; i++) {
            await advance(3_000);
            expect(socket.readyState).toBe(MockSocket.OPEN);
        }

        expect(socket.requestsFor("ping").length).toBe(5);
        expect(socket.readyState).toBe(MockSocket.OPEN);
    });

    test("closes socket when pong response is not received within timeout", async () => {
        const { socket } = await openConnectedEngine();

        // Server never answers ping
        MockSocket.handler = () => {};

        // At T = 3s, first ping is sent and pong timeout (6s) is armed
        await advance(3_000);
        expect(socket.requestsFor("ping").length).toBe(1);
        expect(socket.readyState).toBe(MockSocket.OPEN);

        // Advance past pong timeout (6s after ping was sent, i.e. total 9s from start)
        await advance(6_000);

        // Pong timed out, so socket must have been closed
        expect(socket.readyState).toBe(MockSocket.CLOSED);
    });

    test("server protocol ping clears pong timeout and maintains connection", async () => {
        const { socket } = await openConnectedEngine();

        // Server never answers RPC ping directly
        MockSocket.handler = () => {};

        // Advance 3s -> ping sent, pong timeout armed for 6s
        await advance(3_000);
        expect(socket.requestsFor("ping").length).toBe(1);

        // At 5s after ping, server sends protocol ping frame
        await advance(5_000);
        expect(socket.readyState).toBe(MockSocket.OPEN);
        socket.emit("ping", {});

        // Advance 2s more (total 7s since RPC ping; without server ping it would have timed out at 6s)
        await advance(2_000);
        expect(socket.readyState).toBe(MockSocket.OPEN);
    });
});
