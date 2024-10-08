import { describe, test } from "bun:test";
import { spawnTestServer } from "../surreal.ts";

const { createSurreal, startServer, stopServer } = await spawnTestServer();

describe("reconnect", async () => {
	test(
		"reconnect",
		async () => {
			const surreal = await createSurreal({ reconnect: true });

			// Restarting the server should trigger a reconnect
			await stopServer();
			await startServer();

			// Await automatic connect
			await surreal.emitter.subscribeOnce("connected");
		},
		{
			timeout: 10_000,
		},
	);
});
