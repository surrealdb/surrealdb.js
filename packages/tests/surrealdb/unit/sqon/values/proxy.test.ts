import { describe, expect, test } from "bun:test";
import { DateTime, Decimal, Duration, RecordId, Table, Uuid } from "surrealdb";

// Frameworks like Vue, Svelte and Solid wrap objects in a Proxy whose `get`
// trap forwards with the proxy as receiver, so `this` is the proxy in methods.
function reactive<T extends object>(value: T): T {
    return new Proxy(value, {
        get: (target, key, receiver) => Reflect.get(target, key, receiver),
    });
}

describe("values behind a Proxy", () => {
    const samples = {
        RecordId: new RecordId("a", "1"),
        Table: new Table("a"),
        Uuid: Uuid.v4(),
        Duration: new Duration("1h30m"),
        Decimal: new Decimal("1.5"),
        DateTime: new DateTime(),
    };

    for (const [name, value] of Object.entries(samples)) {
        test(`${name} methods work through a proxy`, () => {
            const proxy = reactive(value);
            expect(proxy.toString()).toBe(value.toString());
            expect(proxy.equals(value)).toBe(true);
            expect((value as typeof proxy).equals(proxy)).toBe(true);
            expect(() => JSON.stringify(proxy)).not.toThrow();
        });
    }

    test("RecordId getters work through a proxy", () => {
        const proxy = reactive(samples.RecordId);
        expect(proxy.table.name).toBe("a");
        expect(proxy.id).toBe("1");
        expect(proxy.equals(new RecordId("b", "2"))).toBe(false);
    });
});
