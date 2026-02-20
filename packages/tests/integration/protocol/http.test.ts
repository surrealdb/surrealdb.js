import { describe, expect, test } from "bun:test";
import { ConnectionUnavailableError } from "surrealdb";
import { createIdleSurreal, createSurreal, SURREAL_PROTOCOL } from "../__helpers__";

describe.if(SURREAL_PROTOCOL === "http")("HTTP protocol", () => {
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
        const { surreal, connect } = await createIdleSurreal();

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
        const { surreal } = await createIdleSurreal();

        expect(async () => {
            await surreal.ready;
        }).toThrow(ConnectionUnavailableError);
    });
});
