import { afterEach, describe, expect, spyOn, test } from "bun:test";
import {
    applyDiagnostics,
    type Diagnostic,
    LiveDispatcher,
    type LiveMessage,
    LiveQueryOverflowError,
    RecordId,
    Surreal,
    Uuid,
} from "surrealdb";
import { FakeEngine } from "./__helpers__/mock-engine";

let open: Surreal | undefined;

afterEach(async () => {
    await open?.close();
    open = undefined;
});

async function setup(diagnostics?: (event: Diagnostic) => void) {
    const engine = new FakeEngine({
        options: {},
        uniqueId: () => "fake",
        codecs: undefined as never,
    });
    const dispatcher = new LiveDispatcher();
    const id = Uuid.v4();
    const key = id.toString();
    let listeners = 0;

    engine.subscribeLiveQuery = (id, listener) => {
        listeners++;
        const unsubscribe = dispatcher.subscribe(
            id.toString(),
            listener.message,
            listener.overflow,
        );

        return () => {
            listeners--;
            unsubscribe();
        };
    };

    const engines = { fake: () => engine };
    const db = new Surreal({
        engines: diagnostics ? applyDiagnostics(engines, diagnostics) : engines,
    });
    await db.connect("fake://", { versionCheck: false });
    open = db;

    const frame = (n: number): LiveMessage => ({
        queryId: id,
        action: "CREATE",
        recordId: new RecordId("person", n),
        value: { n },
    });

    return {
        db,
        engine,
        id,
        frame,
        dispatch: (n: number) => dispatcher.dispatch(key, frame(n)),
        end: () => dispatcher.dispatch(key, { queryId: id, action: "KILLED" }),
        get listeners() {
            return listeners;
        },
    };
}

describe("liveOf() first attachment", () => {
    test("gives the ordered prefix only to the first iterator", async () => {
        const fake = await setup();
        fake.dispatch(1);
        fake.dispatch(2);
        const sub = await fake.db.liveOf(fake.id);
        fake.dispatch(3);

        const first = sub[Symbol.asyncIterator]();
        const second = sub[Symbol.asyncIterator]();
        fake.dispatch(4);

        for (const n of [1, 2, 3, 4]) {
            expect((await first.next()).value).toEqual(fake.frame(n));
        }
        expect((await second.next()).value).toEqual(fake.frame(4));

        await first.return?.();
        await second.return?.();
        await sub.kill();
        expect(fake.listeners).toBe(0);
    });

    test("delivers a buffered KILLED and its prefix even after connection close", async () => {
        const fake = await setup();
        fake.dispatch(1);
        const sub = await fake.db.liveOf(fake.id);
        fake.dispatch(2);
        fake.end();
        await fake.db.close();

        const first = sub[Symbol.asyncIterator]();
        const late = sub[Symbol.asyncIterator]();
        expect((await first.next()).value).toEqual(fake.frame(1));
        expect((await first.next()).value).toEqual(fake.frame(2));
        expect((await first.next()).value).toEqual({ queryId: fake.id, action: "KILLED" });
        expect((await first.next()).done).toBeTrue();
        expect((await late.next()).done).toBeTrue();
        expect(sub.isAlive).toBeFalse();
        expect(fake.listeners).toBe(0);
    });

    test("drains ordered KILLED even if an attached consumer is slow", async () => {
        const fake = await setup();
        const sub = await fake.db.liveOf(fake.id);
        const first = sub[Symbol.asyncIterator]();
        fake.dispatch(1);
        fake.dispatch(2);
        fake.end();

        expect((await first.next()).value).toEqual(fake.frame(1));
        expect((await first.next()).value).toEqual(fake.frame(2));
        expect((await first.next()).value).toEqual({ queryId: fake.id, action: "KILLED" });
        expect((await first.next()).done).toBeTrue();
        await sub.kill();
        expect(fake.engine.sent).toEqual([]);
    });

    test("an overflow already recorded by the engine rejects the first read with its limit", async () => {
        const fake = await setup();
        for (let n = 0; n < 1025; n++) fake.dispatch(n);

        const sub = await fake.db.liveOf(fake.id);
        const first = sub[Symbol.asyncIterator]();
        await expect(first.next()).rejects.toEqual(new LiveQueryOverflowError(fake.id, 1024));
        expect((await first.next()).done).toBeTrue();
        expect(sub.isAlive).toBeFalse();
        expect(fake.listeners).toBe(0);
        expect(fake.engine.sent).toEqual([]);

        await sub.kill();
        await sub.kill();
        expect(fake.engine.sent).toHaveLength(1);
    });

    test("bounds a same-turn burst before first attachment without affecting a sibling", async () => {
        const fake = await setup();
        const delayed = await fake.db.liveOf(fake.id);
        const live = await fake.db.liveOf(fake.id);
        const sibling = live[Symbol.asyncIterator]();

        for (let n = 0; n < 1025; n++) fake.dispatch(n);
        await expect(delayed[Symbol.asyncIterator]().next()).rejects.toBeInstanceOf(
            LiveQueryOverflowError,
        );

        expect(fake.listeners).toBe(1);
        expect(fake.engine.sent).toEqual([]);
        expect((await sibling.next()).value).toEqual(fake.frame(0));
        for (let n = 1; n < 1025; n++) expect((await sibling.next()).value).toEqual(fake.frame(n));

        const next = sibling.next();
        fake.dispatch(1025);
        expect((await next).value).toEqual(fake.frame(1025));
        await live.kill();
        expect(fake.listeners).toBe(0);
    });

    test("shares one exact capacity across dispatcher replay and listener handoff", async () => {
        const fake = await setup();
        for (let n = 0; n < 1023; n++) fake.dispatch(n);
        const sub = await fake.db.liveOf(fake.id);
        fake.dispatch(1023);

        const first = sub[Symbol.asyncIterator]();
        fake.end();

        for (let n = 0; n < 1024; n++) expect((await first.next()).value).toEqual(fake.frame(n));
        expect((await first.next()).value).toEqual({ queryId: fake.id, action: "KILLED" });
        expect((await first.next()).done).toBeTrue();
    });

    test("drops a failed scoped listener on transport loss while retaining the error", async () => {
        const fake = await setup();
        const controller = new AbortController();
        const remove = spyOn(controller.signal, "removeEventListener");
        const sub = await fake.db.withSignal(controller.signal).liveOf(fake.id);
        remove.mockClear();

        for (let n = 0; n < 1025; n++) fake.dispatch(n);
        expect(fake.listeners).toBe(0);
        expect(remove).toHaveBeenCalledTimes(0);

        fake.engine.reconnect();
        await fake.db.ready;

        expect(remove).toHaveBeenCalledTimes(1);
        await expect(sub[Symbol.asyncIterator]().next()).rejects.toBeInstanceOf(
            LiveQueryOverflowError,
        );
        controller.abort();
        expect(fake.engine.sent).toEqual([]);
    });

    test("reports overflow through the callback and default connection error paths", async () => {
        const fake = await setup();
        for (let n = 0; n < 1025; n++) fake.dispatch(n);

        const sub = await fake.db.liveOf(fake.id);
        let received = 0;
        const withHandler = new Promise<unknown>((resolve) => {
            sub.subscribe(() => received++, resolve);
        });
        const defaultHandler = new Promise<unknown>((resolve) => {
            const unlisten = fake.db.subscribe("error", (error) => {
                unlisten();
                resolve(error);
            });

            sub.subscribe(() => received++);
        });

        expect(await withHandler).toBeInstanceOf(LiveQueryOverflowError);
        expect(await defaultHandler).toBeInstanceOf(LiveQueryOverflowError);
        expect(received).toBe(0);
        await sub.kill();
    });

    test("reports both overflow boundaries as failed live-query diagnostics", async () => {
        const results: Array<{ success: boolean; error?: unknown }> = [];
        const fake = await setup((event) => {
            if (event.type === "liveQuery" && event.phase === "after") results.push(event);
        });

        for (let n = 0; n < 1025; n++) fake.dispatch(n);
        const engineOverflow = await fake.db.liveOf(fake.id);
        await expect(engineOverflow[Symbol.asyncIterator]().next()).rejects.toBeInstanceOf(
            LiveQueryOverflowError,
        );

        const appOverflow = await fake.db.liveOf(fake.id);
        for (let n = 0; n < 1025; n++) fake.dispatch(n);
        await expect(appOverflow[Symbol.asyncIterator]().next()).rejects.toBeInstanceOf(
            LiveQueryOverflowError,
        );

        expect(results).toHaveLength(2);

        for (const result of results) {
            expect(result.success).toBeFalse();
            expect(result.error).toBeInstanceOf(LiveQueryOverflowError);
        }

        await appOverflow.kill();
    });

    test("reconnecting ends old readers and late attachment without killing on the new transport", async () => {
        const fake = await setup();
        const sub = await fake.db.liveOf(fake.id);
        const pending = sub[Symbol.asyncIterator]().next();

        fake.engine.reconnect();
        await fake.db.ready;

        expect((await pending).done).toBeTrue();
        expect((await sub[Symbol.asyncIterator]().next()).done).toBeTrue();
        expect(sub.isAlive).toBeFalse();
        expect(fake.listeners).toBe(0);

        await sub.kill();
        expect(fake.engine.sent).toEqual([]);
    });

    test("explicit kill releases pending replay before any application consumer", async () => {
        const fake = await setup();
        const controller = new AbortController();
        const sub = await fake.db.withSignal(controller.signal).liveOf(fake.id);
        fake.dispatch(1);

        controller.abort();
        await sub.kill();

        expect(fake.listeners).toBe(0);
        expect(fake.engine.sent).toHaveLength(1);
        expect(() => sub[Symbol.asyncIterator]()).toThrow("Subscription has been killed");
    });

    test("retains a finite legacy stream before consumer attachment", async () => {
        const fake = await setup();
        fake.engine.subscribeLiveQuery = undefined;
        fake.engine.liveImpl = () => ({
            async *[Symbol.asyncIterator]() {
                yield fake.frame(1);
                yield fake.frame(2);
            },
        });
        const sub = await fake.db.liveOf(fake.id);
        await Bun.sleep(0);

        expect(await Array.fromAsync(sub)).toEqual([fake.frame(1), fake.frame(2)]);
        expect(await Array.fromAsync(sub)).toEqual([]);
    });
});
