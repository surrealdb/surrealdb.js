import { describe, expect, test } from "bun:test";
import { ConnectionUnavailable } from "surrealdb";
import { setupServer } from "../__helpers__";

const { createSurreal, createIdleSurreal } = await setupServer();

describe("HTTP protocol", () => {
	test("basic connection", async () => {
		const surreal = await createSurreal({
			protocol: "http",
		});

		await surreal.ready;
	});

	test("execute query", async () => {
		const surreal = await createSurreal({
			protocol: "http",
		});

		const [result] = await surreal.query("INFO FOR ROOT");

		expect(result).toBeObject();
	});

	test("status events", async () => {
		const { surreal, connect } = createIdleSurreal({
			protocol: "http",
		});

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
		const { surreal } = createIdleSurreal({
			protocol: "ws",
		});

		expect(async () => {
			await surreal.ready;
		}).toThrow(ConnectionUnavailable);
	});
});
