import { describe, expect, test } from "bun:test";
import { ReconnectExhaustionError, Surreal, UnexpectedConnectionError } from "../../../sdk/src";

describe("connection refusal", () => {
    test("rejects immediately when reconnect is false", async () => {
        const db = new Surreal();

        await expect(
            db.connect("ws://127.0.0.1:48293", { reconnect: false }),
        ).rejects.toThrow(UnexpectedConnectionError);

        expect(db.status).toBe("disconnected");
    });

    test("rejects with ReconnectExhaustionError when reconnect attempts are exhausted", async () => {
        const db = new Surreal();

        await expect(
            db.connect("ws://127.0.0.1:48293", {
                reconnect: {
                    attempts: 2,
                    retryDelay: 5,
                    retryDelayMax: 5,
                    retryDelayJitter: 0,
                },
            }),
        ).rejects.toThrow(ReconnectExhaustionError);

        expect(db.status).toBe("disconnected");
    });

    test("subsequent call to ready() rejects if connection was not established", async () => {
        const db = new Surreal();

        try {
            await db.connect("ws://127.0.0.1:48293", { reconnect: false });
        } catch {
            // expected
        }

        await expect(db.ready).rejects.toThrow(UnexpectedConnectionError);
    });
});
