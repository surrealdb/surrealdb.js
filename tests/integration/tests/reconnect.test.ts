import { describe, expect, test } from "bun:test";
import { RecordId } from "../../../src";
import { setupServer } from "../surreal.ts";

const { createSurreal, kill, spawn } = await setupServer();

describe("reconnect", async () => {
	test("restart on reconnect", async () => {
		const surreal = await createSurreal({
			reconnect: {
				enabled: true,
				auth: {
					username: "root",
					password: "root",
				},
			},
		});

		let didReconnect = false;

		surreal.emitter.subscribe("reconnecting", () => {
			didReconnect = true;
		});

		const id = new RecordId("test", 1);
		const req0 = surreal.upsert(id);
		const req1 = Bun.sleep(1000).then(() => surreal.upsert(id));

		await req0;

		await kill();
		await spawn();

		const res = { id };
		expect(req0).resolves.toMatchObject(res);
		expect(req1).resolves.toMatchObject(res);

		await Bun.sleep(2000);
		expect(didReconnect).toBe(true);
	});
});
