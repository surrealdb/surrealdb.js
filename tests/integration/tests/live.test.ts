import { describe, test, expect } from "bun:test";
import { type LiveAction, RecordId, ResponseError, Uuid } from "../../../src";
import { setupServer } from "../surreal.ts";

const { createSurreal } = await setupServer();

async function withTimeout(p: Promise<void>, ms: number): Promise<void> {
    const { promise, resolve, reject } = Promise.withResolvers<void>();
    const timeout = setTimeout(() => reject(new Error("Timeout")), ms);

    await Promise.race([
        promise,
        p.then(resolve).finally(() => clearTimeout(timeout)),
    ]);
}

describe("Live Queries", async () => {
    const surreal = await createSurreal();

    test("live", async () => {
        if (surreal.connection?.connection.url?.protocol.startsWith("http")) {
            expect(surreal.live("person")).rejects.toBeInstanceOf(
                ResponseError,
            );
        } else {
            const events: {
                action: LiveAction;
                result: Record<string, unknown>;
            }[] = [];
            const { promise, resolve } = Promise.withResolvers<void>();

            const queryUuid = await surreal.live("person", (action, result) => {
                events.push({ action, result });
                if (action === "DELETE") resolve();
            });

            expect(queryUuid).toBeInstanceOf(Uuid);

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

            expect(events).toMatchObject([
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
    });

    test("unsubscribe live", async () => {
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

            const queryUuid = await surreal.live(
                "person",
                (action: LiveAction) => {
                    if (action === "DELETE") resolve();
                },
            );
            await surreal.subscribeLive(queryUuid, primaryLiveHandler);
            await surreal.subscribeLive(queryUuid, secondaryLiveHandler);

            await surreal.create(new RecordId("person", 1), {
                firstname: "John",
            });

            await surreal.unSubscribeLive(queryUuid, secondaryLiveHandler);

            await surreal.update(new RecordId("person", 1), {
                firstname: "Jane",
            });
            await surreal.delete(new RecordId("person", 1));

            await withTimeout(promise, 5e3); // Wait for the DELETE event

            expect(primaryLiveHandlerCallCount).toBeGreaterThan(
                secondaryLiveHandlerCallCount,
            );
        }
    });

    test("kill", async () => {
        if (surreal.connection?.connection.url?.protocol !== "ws:") {
            // Not supported
        } else {
            const { promise, resolve } = Promise.withResolvers<void>();

            let primaryLiveHandlerCallCount = 0;
            let secondaryLiveHandlerCallCount = 0;

            const primaryLiveHandler = (action: LiveAction) => {
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

            expect(primaryQueryUuid.toString()).not.toEqual(
                secondaryQueryUuid.toString(),
            );

            await surreal.create(new RecordId("person", 1), {
                firstname: "John",
            });

            await surreal.kill(secondaryQueryUuid);

            await surreal.update(new RecordId("person", 1), {
                firstname: "Jane",
            });
            await surreal.delete(new RecordId("person", 1));

            await withTimeout(promise, 5e3); // Wait for the DELETE event

            expect(primaryLiveHandlerCallCount).toBeGreaterThan(
                secondaryLiveHandlerCallCount,
            );
        }
    });
});
