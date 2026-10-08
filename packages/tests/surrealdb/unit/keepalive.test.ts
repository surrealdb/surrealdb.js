import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { ConnectionState, DriverOptions } from "surrealdb";
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

    async function openConnectedEngine(
        driverOptions: Partial<DriverOptions> = {},
        stateOptions: Partial<ConnectionState> = {},
    ): Promise<{ engine: WebSocketEngine; socket: MockSocket }> {
        const context = mockContext({ streaming: false, ...driverOptions });
        const opened = new WebSocketEngine(context);
        engine = opened;

        const connected = new Promise<void>((resolve) => {
            const unsubscribe = opened.subscribe("connected", () => {
                unsubscribe();
                resolve();
            });
        });

        opened.open(mockState(false, stateOptions));

        // Advance to run open microtask
        await flush();
        await connected;

        return { engine: opened, socket: MockSocket.current };
    }

    test("sends a ping every 30 seconds by default", async () => {
        const { socket } = await openConnectedEngine();

        expect(socket.requestsFor("ping").length).toBe(0);

        // Advance 30 seconds
        await advance(30_000);
        expect(socket.requestsFor("ping").length).toBe(1);

        // Server responds to ping
        socket.respond({ id: socket.requestsFor("ping")[0].id, result: null });
        await flush();

        // Advance another 30 seconds
        await advance(30_000);
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
        for (let i = 0; i < 3; i++) {
            await advance(30_000);
            expect(socket.readyState).toBe(MockSocket.OPEN);
        }

        expect(socket.requestsFor("ping").length).toBe(3);
        expect(socket.readyState).toBe(MockSocket.OPEN);
    });

    test("closes socket when pong response is not received within default 10s timeout", async () => {
        const { socket } = await openConnectedEngine();

        // Server never answers ping
        MockSocket.handler = () => {};

        // At T = 30s, first ping is sent and pong timeout (10s) is armed
        await advance(30_000);
        expect(socket.requestsFor("ping").length).toBe(1);
        expect(socket.readyState).toBe(MockSocket.OPEN);

        // Advance 9s -> still open
        await advance(9_000);
        expect(socket.readyState).toBe(MockSocket.OPEN);

        // Advance 1s more (total 10s after ping)
        await advance(1_000);

        // Pong timed out, so socket must have been closed
        expect(socket.readyState).toBe(MockSocket.CLOSED);
    });

    test("does not send another ping while still awaiting a pong", async () => {
        // Configure pingInterval to 5s and pongTimeout to 12s so ping interval ticks while waiting
        const { socket } = await openConnectedEngine(
            {},
            { pingInterval: 5_000, pongTimeout: 12_000 },
        );

        // Server never answers ping
        MockSocket.handler = () => {};

        // At T = 5s, first ping is sent, pong timeout armed for 12s
        await advance(5_000);
        expect(socket.requestsFor("ping").length).toBe(1);

        // At T = 10s (5s later), the interval fires, but pong is still pending
        await advance(5_000);
        // Still only 1 ping sent!
        expect(socket.requestsFor("ping").length).toBe(1);
        expect(socket.readyState).toBe(MockSocket.OPEN);

        // At T = 17s (total 12s after first ping at T = 5s), pong timeout expires
        await advance(7_000);
        expect(socket.readyState).toBe(MockSocket.CLOSED);
    });

    test("allows pingInterval and pongTimeout to be configured via DriverOptions", async () => {
        const { socket } = await openConnectedEngine({ pingInterval: 3_000, pongTimeout: 2_000 });

        MockSocket.handler = () => {};

        // At T = 3s, ping sent
        await advance(3_000);
        expect(socket.requestsFor("ping").length).toBe(1);
        expect(socket.readyState).toBe(MockSocket.OPEN);

        // At T = 5s (3s + 2s pong timeout), socket closes
        await advance(2_000);
        expect(socket.readyState).toBe(MockSocket.CLOSED);
    });

    test("allows pingInterval and pongTimeout to be configured via ConnectOptions / state", async () => {
        const { socket } = await openConnectedEngine(
            {},
            { pingInterval: 2_000, pongTimeout: 1_000 },
        );

        MockSocket.handler = () => {};

        // At T = 2s, ping sent
        await advance(2_000);
        expect(socket.requestsFor("ping").length).toBe(1);
        expect(socket.readyState).toBe(MockSocket.OPEN);

        // At T = 3s (2s + 1s pong timeout), socket closes
        await advance(1_000);
        expect(socket.readyState).toBe(MockSocket.CLOSED);
    });

    test("server protocol ping clears pong timeout and maintains connection", async () => {
        const { socket } = await openConnectedEngine();

        // Server never answers RPC ping directly
        MockSocket.handler = () => {};

        // Advance 30s -> ping sent, pong timeout armed for 10s
        await advance(30_000);
        expect(socket.requestsFor("ping").length).toBe(1);

        // At 8s after ping, server sends protocol ping frame
        await advance(8_000);
        expect(socket.readyState).toBe(MockSocket.OPEN);
        socket.emit("ping", {});

        // Advance 5s more (total 13s since RPC ping; without server ping it would have timed out at 10s)
        await advance(5_000);
        expect(socket.readyState).toBe(MockSocket.OPEN);
    });
});
