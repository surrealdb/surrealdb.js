import { describe, expect, test } from "bun:test";
import { RecordId } from "../../../packages/_legacy/src/index.ts";
import { PROTOCOL, setupServer } from "../surreal.ts";

const { createSurreal, kill, spawn } = await setupServer();

describe("reconnect", async () => {
	test.skipIf(PROTOCOL === "http")("restart on reconnect", async () => {
		const surreal = await createSurreal({
			auth: "root",
			reconnect: {
				enabled: true,
			},
		});

		let didReconnect = false;

		surreal.emitter.subscribe("reconnecting", () => {
			didReconnect = true;
		});

		const id1 = new RecordId("test", 1);
		const id2 = new RecordId("test", 2);
		const req1 = surreal.create(id1);
		const req2 = Bun.sleep(1000).then(() => surreal.create(id2));

		await req1;

		await kill();
		await spawn();

		expect(req1).resolves.toMatchObject({ id: id1 });
		expect(req2).resolves.toMatchObject({ id: id2 });

		await Bun.sleep(2000);
		expect(didReconnect).toBe(true);
	});
});
