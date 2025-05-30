import { describe, expect, mock, test } from "bun:test";
import { RecordId, type Uuid } from "surrealdb";
import { insertMockRecords, personTable, setupServer } from "../__helpers__";

const { createSurreal, kill, spawn } = await setupServer();

describe("live() / liveOf()", async () => {
	const surreal = await createSurreal({
		protocol: "ws",
		reconnect: {
			enabled: true,
		},
	});

	await insertMockRecords(surreal);

	test("subscription properties", async () => {
		const subscription = await surreal.live(personTable);

		expect(subscription.isAlive).toBeTrue();
		expect(subscription.isManaged).toBeTrue();
		expect(subscription.resource).toEqual(personTable);

		await subscription.kill();

		expect(subscription.isAlive).toBeFalse();
	});

	test("create action", async () => {
		const subscription = await surreal.live(personTable);
		const { promise, resolve } = Promise.withResolvers();
		const mockHandler = mock(() => resolve());

		subscription.subscribe(mockHandler);

		await surreal.create(new RecordId("person", 3), {
			firstname: "John",
			lastname: "Doe",
		});

		await promise;

		expect(mockHandler).toBeCalledTimes(1);
		expect(mockHandler).toBeCalledWith(
			"CREATE",
			{
				id: new RecordId("person", 3),
				firstname: "John",
				lastname: "Doe",
			},
			new RecordId("person", 3),
		);

		await subscription.kill();
	});

	test("update action", async () => {
		const subscription = await surreal.live(personTable);
		const { promise, resolve } = Promise.withResolvers();
		const mockHandler = mock(() => resolve());

		subscription.subscribe(mockHandler);

		await surreal.update(new RecordId("person", 3), {
			firstname: "John",
			lastname: "Doe",
			age: 20,
		});

		await promise;

		expect(mockHandler).toBeCalledTimes(1);
		expect(mockHandler).toBeCalledWith(
			"UPDATE",
			{
				id: new RecordId("person", 3),
				firstname: "John",
				lastname: "Doe",
				age: 20,
			},
			new RecordId("person", 3),
		);

		await subscription.kill();
	});

	test("delete action", async () => {
		const subscription = await surreal.live(personTable);
		const { promise, resolve } = Promise.withResolvers();
		const mockHandler = mock(() => resolve());

		subscription.subscribe(mockHandler);

		await surreal.delete(new RecordId("person", 3));

		await promise;

		expect(mockHandler).toBeCalledTimes(1);
		expect(mockHandler).toBeCalledWith(
			"DELETE",
			{
				id: new RecordId("person", 3),
				firstname: "John",
				lastname: "Doe",
				age: 20,
			},
			new RecordId("person", 3),
		);

		await subscription.kill();
	});

	test("reconnect and resume", async () => {
		const subscription = await surreal.live(personTable);
		const { promise, resolve } = Promise.withResolvers();
		const mockHandler = mock(() => resolve());

		subscription.subscribe(mockHandler);

		const initialId = subscription.id;

		// Restart server and wait for reconnection
		await kill();
		await spawn();
		await surreal.ready;

		// Make sure we obtained a new live id
		expect(initialId).not.toEqual(subscription.id);

		await surreal.create(new RecordId("person", 3), {
			firstname: "John",
			lastname: "Doe",
		});

		await promise;

		expect(mockHandler).toBeCalledTimes(1);
		expect(mockHandler).toBeCalledWith(
			"CREATE",
			{
				id: new RecordId("person", 3),
				firstname: "John",
				lastname: "Doe",
			},
			new RecordId("person", 3),
		);

		await subscription.kill();

		expect(subscription.isAlive).toBeFalse();
	});

	test("unmanaged subscription properties", async () => {
		const [liveId] = await surreal.query<[Uuid]>("LIVE SELECT * FROM person");
		const subscription = await surreal.liveOf(liveId);

		expect(subscription.isAlive).toBeTrue();
		expect(subscription.isManaged).toBeFalse();
		expect(subscription.resource).toBeUndefined();

		await subscription.kill();

		expect(subscription.isAlive).toBeFalse();
	});

	test("unmanaged create action", async () => {
		const [liveId] = await surreal.query<[Uuid]>("LIVE SELECT * FROM person");
		const subscription = await surreal.liveOf(liveId);
		const { promise, resolve } = Promise.withResolvers();
		const mockHandler = mock(() => resolve());

		subscription.subscribe(mockHandler);

		await surreal.create(new RecordId("person", 4), {
			firstname: "John",
			lastname: "Doe",
		});

		await promise;

		expect(mockHandler).toBeCalledTimes(1);
		expect(mockHandler).toBeCalledWith(
			"CREATE",
			{
				id: new RecordId("person", 4),
				firstname: "John",
				lastname: "Doe",
			},
			new RecordId("person", 4),
		);

		await subscription.kill();
	});

	test("iterator", async () => {
		const subscription = await surreal.live(personTable);
		const iterator = subscription.iterate();

		await surreal.create(new RecordId("person", 5), {
			firstname: "John",
			lastname: "Doe",
		});

		await surreal.merge(new RecordId("person", 5), {
			firstname: "Mary",
		});

		await surreal.delete(new RecordId("person", 5));

		expect(await iterator.next()).toEqual({
			done: false,
			value: [
				"CREATE",
				{
					id: new RecordId("person", 5),
					firstname: "John",
					lastname: "Doe",
				},
				new RecordId("person", 5),
			],
		});
		expect(await iterator.next()).toEqual({
			done: false,
			value: [
				"UPDATE",
				{
					id: new RecordId("person", 5),
					firstname: "Mary",
					lastname: "Doe",
				},
				new RecordId("person", 5),
			],
		});
		expect(await iterator.next()).toEqual({
			done: false,
			value: [
				"DELETE",
				{
					id: new RecordId("person", 5),
					firstname: "Mary",
					lastname: "Doe",
				},
				new RecordId("person", 5),
			],
		});

		await subscription.kill();

		expect(await iterator.next()).toEqual({
			done: true,
			value: ["CLOSED", "KILLED"],
		});
	});

	test("iterator survives reconnect", async () => {
		const subscription = await surreal.live(personTable);
		const iterator = subscription.iterate();
		const initialId = subscription.id;

		// Restart server and wait for reconnection
		await kill();
		await spawn();
		await surreal.ready;

		// Make sure we obtained a new live id
		expect(initialId).not.toEqual(subscription.id);

		await surreal.create(new RecordId("person", 6), {
			firstname: "John",
			lastname: "Doe",
		});

		expect(await iterator.next()).toEqual({
			done: false,
			value: [
				"CREATE",
				{
					id: new RecordId("person", 6),
					firstname: "John",
					lastname: "Doe",
				},
				new RecordId("person", 6),
			],
		});

		subscription.kill();

		expect(await iterator.next()).toEqual({
			done: true,
			value: ["CLOSED", "KILLED"],
		});

		expect(subscription.isAlive).toBeFalse();
	});
});
