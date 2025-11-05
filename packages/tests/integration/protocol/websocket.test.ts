import { describe, expect, test } from "bun:test";
import { ConnectionUnavailableError } from "surrealdb";
import {
    createIdleSurreal,
    createSurreal,
    killServer,
    SURREAL_PROTOCOL,
    spawnServer,
} from "../__helpers__";

describe.if(SURREAL_PROTOCOL === "ws")("WebSocket protocol", () => {
    test("basic connection", async () => {
        const surreal = await createSurreal();

        await surreal.ready;
    });

    test("execute query", async () => {
        const surreal = await createSurreal();

        const [result] = await surreal.query("INFO FOR ROOT").collect();

        expect(result).toBeObject();
    });

    test("status events", async () => {
        const { surreal, connect } = createIdleSurreal();

        let phase = 0;

        surreal.subscribe("connecting", () => {
            if (phase === 0) {
                phase = 1;
            }
        });

        surreal.subscribe("connected", () => {
            if (phase === 1) {
                phase = 2;
            }
        });

        surreal.subscribe("disconnected", () => {
            if (phase === 2) {
                phase = 3;
            }
        });

        await connect();
        await surreal.ready;
        await surreal.close();

        expect(phase).toBe(3);
    });

    test("connection unavailable", async () => {
        const { surreal } = createIdleSurreal();

        expect(async () => {
            await surreal.ready;
        }).toThrow(ConnectionUnavailableError);
    });

    test("reconnect on disconnect", async () => {
        const surreal = await createSurreal({
            reconnect: {
                enabled: true,
            },
        });

        const reconnectPromise = Promise.withResolvers();
        const connectedPromise = Promise.withResolvers();

        surreal.subscribe("reconnecting", () => reconnectPromise.resolve());
        surreal.subscribe("connected", () => connectedPromise.resolve());

        await killServer();
        spawnServer(); // do not await

        await reconnectPromise.promise;
        await connectedPromise.promise;
    });
});
