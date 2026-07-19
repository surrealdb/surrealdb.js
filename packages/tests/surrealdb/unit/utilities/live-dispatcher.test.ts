import { describe, expect, test } from "bun:test";
import { LiveDispatcher, type LiveMessage, RecordId, Uuid } from "surrealdb";

function message(action: LiveMessage["action"], value: unknown): LiveMessage {
    return {
        queryId: Uuid.v4(),
        action,
        recordId: new RecordId("thing", 1),
        value: value as LiveMessage["value"],
    };
}

describe("LiveDispatcher", () => {
    test("is exported from the package root", () => {
        expect(typeof LiveDispatcher).toBe("function");
    });

    test("delivers notifications to an attached subscriber", () => {
        const dispatcher = new LiveDispatcher();
        const received: LiveMessage[] = [];

        dispatcher.subscribe("a", (m) => received.push(m));
        const msg = message("CREATE", { n: 1 });
        dispatcher.dispatch("a", msg);

        expect(received).toEqual([msg]);
    });

    test("buffers a notification that arrives before subscription and replays it", () => {
        const dispatcher = new LiveDispatcher();
        const early = message("CREATE", { n: 1 });

        // Notification arrives before anyone has subscribed for this id.
        dispatcher.dispatch("a", early);

        const received: LiveMessage[] = [];
        dispatcher.subscribe("a", (m) => received.push(m));

        // The buffered notification is replayed on subscribe.
        expect(received).toEqual([early]);
    });

    test("preserves order: buffered notifications precede live ones", () => {
        const dispatcher = new LiveDispatcher();
        const first = message("CREATE", { n: 1 });
        const second = message("UPDATE", { n: 2 });

        dispatcher.dispatch("a", first); // buffered
        const received: LiveMessage[] = [];
        dispatcher.subscribe("a", (m) => received.push(m));
        dispatcher.dispatch("a", second); // live

        expect(received).toEqual([first, second]);
    });

    test("does not leak buffered notifications across ids", () => {
        const dispatcher = new LiveDispatcher();
        dispatcher.dispatch("a", message("CREATE", { n: 1 }));

        const received: LiveMessage[] = [];
        dispatcher.subscribe("b", (m) => received.push(m));

        expect(received).toEqual([]);
    });

    test("fans out live notifications to multiple subscribers of the same id", () => {
        const dispatcher = new LiveDispatcher();
        const a: LiveMessage[] = [];
        const b: LiveMessage[] = [];

        dispatcher.subscribe("id", (m) => a.push(m));
        dispatcher.subscribe("id", (m) => b.push(m));

        const msg = message("CREATE", { n: 1 });
        dispatcher.dispatch("id", msg);

        expect(a).toEqual([msg]);
        expect(b).toEqual([msg]);
    });

    test("unsubscribe stops delivery", () => {
        const dispatcher = new LiveDispatcher();
        const received: LiveMessage[] = [];

        const unsubscribe = dispatcher.subscribe("a", (m) => received.push(m));
        unsubscribe();
        dispatcher.dispatch("a", message("CREATE", { n: 1 }));

        expect(received).toEqual([]);
    });

    test("clear() drops buffered notifications", () => {
        const dispatcher = new LiveDispatcher();
        dispatcher.dispatch("a", message("CREATE", { n: 1 }));
        dispatcher.clear();

        const received: LiveMessage[] = [];
        dispatcher.subscribe("a", (m) => received.push(m));

        expect(received).toEqual([]);
    });

    test("bounds the buffer, dropping the oldest beyond the limit", () => {
        const dispatcher = new LiveDispatcher(2);
        const a = message("CREATE", { n: 1 });
        const b = message("CREATE", { n: 2 });
        const c = message("CREATE", { n: 3 });

        dispatcher.dispatch("a", a);
        dispatcher.dispatch("a", b);
        dispatcher.dispatch("a", c); // exceeds limit of 2 -> drops `a`

        const received: LiveMessage[] = [];
        dispatcher.subscribe("a", (m) => received.push(m));

        expect(received).toEqual([b, c]);
    });
});
