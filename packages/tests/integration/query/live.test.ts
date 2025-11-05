import { describe, expect, mock, test } from "bun:test";
import { eq, type LiveMessage, RecordId, type Uuid } from "surrealdb";
import {
    createSurreal,
    insertMockRecords,
    type Person,
    personTable,
    respawnServer,
} from "../__helpers__";

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

    test.todo("create action", async () => {
        const subscription = await surreal.live(personTable);
        const { promise, resolve } = Promise.withResolvers();
        const mockHandler = mock(() => resolve());

        subscription.subscribe(mockHandler);

        await surreal.create(new RecordId("person", 3)).content({
            firstname: "John",
            lastname: "Doe",
        });

        await promise;

        expect(mockHandler).toBeCalledTimes(1);
        expect(mockHandler).toBeCalledWith({
            action: "CREATE",
            queryId: subscription.id,
            recordId: new RecordId("person", 3),
            value: {
                id: new RecordId("person", 3),
                firstname: "John",
                lastname: "Doe",
            },
        });

        await subscription.kill();
    });

    test.todo("update action", async () => {
        const subscription = await surreal.live(personTable);
        const { promise, resolve } = Promise.withResolvers();
        const mockHandler = mock(() => resolve());

        subscription.subscribe(mockHandler);

        await surreal.update(new RecordId("person", 3)).content({
            firstname: "John",
            lastname: "Doe",
            age: 20,
        });

        await promise;

        expect(mockHandler).toBeCalledTimes(1);
        expect(mockHandler).toBeCalledWith({
            action: "UPDATE",
            queryId: subscription.id,
            recordId: new RecordId("person", 3),
            value: {
                id: new RecordId("person", 3),
                firstname: "John",
                lastname: "Doe",
                age: 20,
            },
        });

        await subscription.kill();
    });

    test.todo("delete action", async () => {
        const subscription = await surreal.live(personTable);
        const { promise, resolve } = Promise.withResolvers();
        const mockHandler = mock(() => resolve());

        subscription.subscribe(mockHandler);

        await surreal.delete(new RecordId("person", 3));

        await promise;

        expect(mockHandler).toBeCalledTimes(1);
        expect(mockHandler).toBeCalledWith({
            action: "DELETE",
            queryId: subscription.id,
            recordId: new RecordId("person", 3),
            value: {
                id: new RecordId("person", 3),
                firstname: "John",
                lastname: "Doe",
                age: 20,
            },
        });

        await subscription.kill();
    });

    test.todo("reconnect and resume", async () => {
        const subscription = await surreal.live(personTable);
        const { promise, resolve } = Promise.withResolvers();
        const mockHandler = mock(() => resolve());

        subscription.subscribe(mockHandler);

        const initialId = subscription.id;

        // Restart server and wait for reconnection
        await respawnServer();
        await surreal.ready;

        // Make sure we obtained a new live id
        expect(initialId).not.toEqual(subscription.id);

        await surreal.create(new RecordId("person", 3)).content({
            firstname: "John",
            lastname: "Doe",
        });

        await promise;

        expect(mockHandler).toBeCalledTimes(1);
        expect(mockHandler).toBeCalledWith({
            action: "CREATE",
            queryId: subscription.id,
            recordId: new RecordId("person", 3),
            value: {
                id: new RecordId("person", 3),
                firstname: "John",
                lastname: "Doe",
            },
        });

        await subscription.kill();

        expect(subscription.isAlive).toBeFalse();
    });

    test.todo("unmanaged subscription properties", async () => {
        const [liveId] = await surreal.query("LIVE SELECT * FROM person").collect<[Uuid]>();
        const subscription = await surreal.liveOf(liveId);

        expect(subscription.isAlive).toBeTrue();
        expect(subscription.isManaged).toBeFalse();
        expect(subscription.resource).toBeUndefined();

        await subscription.kill();

        expect(subscription.isAlive).toBeFalse();
    });

    test.todo("unmanaged create action", async () => {
        const [liveId] = await surreal.query("LIVE SELECT * FROM person").collect<[Uuid]>();
        const subscription = await surreal.liveOf(liveId);
        const { promise, resolve } = Promise.withResolvers();
        const mockHandler = mock(() => resolve());

        subscription.subscribe(mockHandler);

        await surreal.create(new RecordId("person", 4)).content({
            firstname: "John",
            lastname: "Doe",
        });

        await promise;

        expect(mockHandler).toBeCalledTimes(1);
        expect(mockHandler).toBeCalledWith({
            action: "CREATE",
            queryId: subscription.id,
            recordId: new RecordId("person", 4),
            value: {
                id: new RecordId("person", 4),
                firstname: "John",
                lastname: "Doe",
            },
        });

        await subscription.kill();
    });

    test.todo("iterable", async () => {
        const subscription = await surreal.live(personTable);
        const messages: LiveMessage[] = [];

        (async () => {
            await Bun.sleep(100);

            await surreal.create(new RecordId("person", 5)).content({
                firstname: "John",
                lastname: "Doe",
            });

            await surreal.update(new RecordId("person", 5)).content({
                firstname: "Mary",
            });

            await surreal.delete(new RecordId("person", 5));

            await Bun.sleep(100);

            await subscription.kill();
        })();

        for await (const message of subscription) {
            messages.push(message);
        }

        expect(messages[0].action).toEqual("CREATE");
        expect(messages[1].action).toEqual("UPDATE");
        expect(messages[2].action).toEqual("DELETE");
    });

    test.todo("iterable survives reconnect", async () => {
        const subscription = await surreal.live(personTable);
        const initialId = subscription.id;
        const messages: LiveMessage[] = [];

        let latestId: Uuid = initialId;

        (async () => {
            await Bun.sleep(100);

            // Restart server and wait for reconnection
            await respawnServer();
            await surreal.ready;

            await surreal.create(new RecordId("person", 5)).content({
                firstname: "John",
                lastname: "Doe",
            });

            await surreal.update(new RecordId("person", 5)).content({
                firstname: "Mary",
            });

            await surreal.delete(new RecordId("person", 5));

            latestId = subscription.id;

            await Bun.sleep(100);

            await subscription.kill();
        })();

        for await (const message of subscription) {
            messages.push(message);
        }

        expect(latestId).not.toEqual(initialId);

        expect(messages[0].action).toEqual("CREATE");
        expect(messages[1].action).toEqual("UPDATE");
        expect(messages[2].action).toEqual("DELETE");
    });

    test("compile", async () => {
        const builder = surreal
            .live<Person>(personTable)
            .fields("age", "test", "lastname")
            .where(eq("age", 30))
            .fetch("foo");

        const { query, bindings } = builder.compile();

        expect(query).toMatchSnapshot();
        expect(bindings).toMatchSnapshot();
    });
});
