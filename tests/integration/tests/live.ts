import { createSurreal } from "../surreal.ts";

import {
	assert,
	assertEquals,
	assertGreater,
	assertNotEquals,
	assertRejects,
} from "@std/assert";
import { type Action, RecordId, UUID } from "../../../mod.ts";

async function withTimeout(p: Promise<void>, ms: number): Promise<void> {
	const { promise, resolve, reject } = Promise.withResolvers<void>();
	const timeout = setTimeout(() => reject(new Error("Timeout")), ms);

	await Promise.race([
		promise,
		p.then(resolve).finally(() => clearTimeout(timeout)),
	]);
}

Deno.test("live", async () => {
	const surreal = await createSurreal();

	if (surreal.connection?.connection.url?.protocol !== "ws:") {
		await assertRejects(async () => {
			await surreal.live("person");
		});
	} else {
		const events: { action: Action; result: Record<string, unknown> }[] =
			[];
		const { promise, resolve } = Promise.withResolvers<void>();

		const queryUuid = await surreal.live("person", (action, result) => {
			events.push({ action, result });
			if (action === "DELETE") resolve();
		});

		assert(queryUuid instanceof UUID);

		await surreal.create(new RecordId("person", 1), {
			firstname: "John",
			lastname: "Doe",
		});
		await surreal.update(new RecordId("person", 1), {
			firstname: "Jane",
			lastname: "Doe",
		});
		await surreal.delete(new RecordId("person", 1));

		await withTimeout(promise, 5e3); // Wait for the DELETE event

		assertEquals(events, [
			{
				action: "CREATE",
				result: {
					id: new RecordId("person", 1),
					firstname: "John",
					lastname: "Doe",
				},
			},
			{
				action: "UPDATE",
				result: {
					id: new RecordId("person", 1),
					firstname: "Jane",
					lastname: "Doe",
				},
			},
			{
				action: "DELETE",
				result: {
					id: new RecordId("person", 1),
					firstname: "Jane",
					lastname: "Doe",
				},
			},
		]);
	}

	await surreal.close();
});

Deno.test("unsubscribe live", async () => {
	const surreal = await createSurreal();

	if (surreal.connection?.connection.url?.protocol !== "ws:") {
		// Not supported
	} else {
		const { promise, resolve } = Promise.withResolvers<void>();

		let primaryLiveHandlerCallCount = 0;
		let secondaryLiveHandlerCallCount = 0;

		const primaryLiveHandler = () => {
			primaryLiveHandlerCallCount += 1;
		};
		const secondaryLiveHandler = () => {
			secondaryLiveHandlerCallCount += 1;
		};

		const queryUuid = await surreal.live("person", (action: Action) => {
			if (action === "DELETE") resolve();
		});
		await surreal.subscribeLive(queryUuid, primaryLiveHandler);
		await surreal.subscribeLive(queryUuid, secondaryLiveHandler);

		await surreal.create(new RecordId("person", 1), { firstname: "John" });

		await surreal.unSubscribeLive(queryUuid, secondaryLiveHandler);

		await surreal.update(new RecordId("person", 1), { firstname: "Jane" });
		await surreal.delete(new RecordId("person", 1));

		await withTimeout(promise, 5e3); // Wait for the DELETE event

		assertGreater(
			primaryLiveHandlerCallCount,
			secondaryLiveHandlerCallCount,
		);
	}

	await surreal.close();
});

Deno.test("kill", async () => {
	const surreal = await createSurreal();

	if (surreal.connection?.connection.url?.protocol !== "ws:") {
		// Not supported
	} else {
		const { promise, resolve } = Promise.withResolvers<void>();

		let primaryLiveHandlerCallCount = 0;
		let secondaryLiveHandlerCallCount = 0;

		const primaryLiveHandler = (action: Action) => {
			primaryLiveHandlerCallCount += 1;
			if (action === "DELETE") resolve();
		};
		const secondaryLiveHandler = () => {
			secondaryLiveHandlerCallCount += 1;
		};

		const primaryQueryUuid = await surreal.live(
			"person",
			primaryLiveHandler,
		);
		const secondaryQueryUuid = await surreal.live(
			"person",
			secondaryLiveHandler,
		);

		assertNotEquals(
			primaryQueryUuid.toString(),
			secondaryQueryUuid.toString(),
		);

		await surreal.create(new RecordId("person", 1), { firstname: "John" });

		await surreal.kill(secondaryQueryUuid);

		await surreal.update(new RecordId("person", 1), { firstname: "Jane" });
		await surreal.delete(new RecordId("person", 1));

		await withTimeout(promise, 5e3); // Wait for the DELETE event

		assertGreater(
			primaryLiveHandlerCallCount,
			secondaryLiveHandlerCallCount,
		);
	}

	await surreal.close();
});
