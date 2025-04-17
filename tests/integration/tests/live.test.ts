import { describe, expect, test } from "bun:test";
import {
	type LiveHandlerArguments,
	RecordId,
	ResponseError,
	type Surreal,
	Uuid,
} from "../../../src";
import { setupServer } from "../surreal.ts";

const { createSurreal } = await setupServer();

const isHttp = (surreal: Surreal) =>
	!!surreal.connection?.connection.url?.protocol.startsWith("http");

describe("Live Queries", async () => {
	const surreal = await createSurreal();
	const http = isHttp(surreal);

	test.skipIf(!http)("not supported on HTTP", () => {
		expect(surreal.live("person")).rejects.toBeInstanceOf(ResponseError);
	});

	test.skipIf(http)("live", async () => {
		const events = new CollectablePromise<{
			action: LiveHandlerArguments[0];
			result: LiveHandlerArguments[1];
		}>(3);

		const queryUuid = await surreal.live("person", (action, result) => {
			if (action === "CLOSE") return;
			events.push({ action, result });
		});

		expect(queryUuid).toBeInstanceOf(Uuid);

		// Create some live notifications
		await surreal.create(new RecordId("person", 1), {
			firstname: "John",
			lastname: "Doe",
		});
		await surreal.update(new RecordId("person", 1), {
			firstname: "Jane",
			lastname: "Doe",
		});
		await surreal.delete(new RecordId("person", 1));

		expect(events.then((a) => a)).resolves.toMatchObject([
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
	});

	test.skipIf(http)("unsubscribe", async () => {
		// Prepare
		let primaryCount = 0;
		let secondaryCount = 0;
		function secondaryHandler(...[action]: LiveHandlerArguments) {
			if (action === "CLOSE") return;
			secondaryCount += 1;
			// Unsubscribe secondary listener
			surreal.unSubscribeLive(primaryUuid, secondaryHandler);
		}

		const events = new CollectablePromise<{
			action: LiveHandlerArguments[0];
			result: LiveHandlerArguments[1];
		}>(3);

		// Start live query and register secondary handler
		const primaryUuid = await surreal.live("person", (action, result) => {
			if (action === "CLOSE") return;
			events.push({ action, result });
			primaryCount += 1;
		});

		await surreal.subscribeLive(primaryUuid, secondaryHandler);

		// Create events
		await surreal.create(new RecordId("person", 1), {
			firstname: "John",
		});

		await surreal.update(new RecordId("person", 1), {
			firstname: "Jane",
		});
		await surreal.delete(new RecordId("person", 1));

		// Wait for all events to be collected
		await events;

		await surreal.kill(primaryUuid);

		// Check counts
		expect(primaryCount).toBeGreaterThan(secondaryCount);
	});

	test.skipIf(http)("kill", async () => {
		// Prepare
		let primaryCount = 0;
		let secondaryCount = 0;

		const events = new CollectablePromise<{
			action: LiveHandlerArguments[0];
			result: LiveHandlerArguments[1];
		}>(3);

		// Start live query and register secondary handler
		const primaryUuid = await surreal.live("person", (action, result) => {
			if (action === "CLOSE") return;
			events.push({ action, result });
			primaryCount += 1;
		});

		const secondaryUuid = await surreal.live("person", (action, _) => {
			if (action === "CLOSE") return;
			secondaryCount += 1;
			// Kill secondary live query
			surreal.kill(secondaryUuid);
		});

		// Create events
		await surreal.create(new RecordId("person", 1), {
			firstname: "John",
		});

		await surreal.update(new RecordId("person", 1), {
			firstname: "Jane",
		});
		await surreal.delete(new RecordId("person", 1));

		// Wait for all events to be collected
		await events;

		await surreal.kill(primaryUuid);

		// Check counts
		expect(primaryCount).toBeGreaterThan(secondaryCount);
	});
});

class CollectablePromise<T, Result extends T[] = T[], Err = never> {
	[Symbol.toStringTag] = "CollectablePromise";
	private collection: Result = [] as unknown as Result;
	private promise: Promise<Result>;
	private resolve: (value: Result) => void;
	private amount: number;

	constructor(amount: number) {
		const { promise, resolve } = Promise.withResolvers<Result>();
		this.amount = amount;
		this.promise = promise;
		this.resolve = resolve;
	}

	push(value: T): void {
		this.collection.push(value);
		if (this.collection.length >= this.amount) this.resolve(this.collection);
	}

	// biome-ignore lint/suspicious/noThenProperty: We are intentionally replicating a promise here
	then(
		onfulfilled?:
			| ((value: Result) => Result | PromiseLike<Result>)
			| undefined
			| null,
		onrejected?:
			| ((reason: unknown) => Err | PromiseLike<Err>)
			| undefined
			| null,
	): Promise<Result | Err> {
		return this.promise.then(onfulfilled, onrejected);
	}

	/**
	 * Attaches a callback for only the rejection of the Promise.
	 * @param onrejected The callback to execute when the Promise is rejected.
	 * @returns A Promise for the completion of the callback.
	 */
	catch(
		onrejected?: ((reason: Err) => Err | PromiseLike<Err>) | undefined | null,
	): Promise<Result | Err> {
		return this.promise.catch(onrejected);
	}
}
