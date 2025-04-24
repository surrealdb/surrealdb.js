import { describe, expect, test } from "bun:test";
import { Emitter } from "../../packages/_legacy/src";

describe("emitter", () => {
	test("scan", () => {
		const emitter = new Emitter<{ test: []; other: [] }>();
		expect(emitter.scanListeners().length).toBe(0);

		const listener = () => {};
		emitter.subscribe("test", listener);
		expect(emitter.scanListeners().length).toBe(1);

		const listener2 = () => {};
		emitter.subscribe("other", listener2);
		expect(emitter.scanListeners((k) => k === "other").length).toBe(1);

		expect(emitter.scanListeners().length).toBe(2);

		emitter.unSubscribe("test", listener);
		expect(emitter.scanListeners().length).toBe(1);
		emitter.unSubscribe("other", listener2);
		expect(emitter.scanListeners().length).toBe(0);
	});

	test("listeners are properly cleared out", () => {
		const emitter = new Emitter<{ test: [] }>();
		const listener = () => {};
		const listener2 = () => {};

		emitter.subscribe("test", listener);
		expect(emitter.scanListeners().length).toBe(1);

		emitter.unSubscribe("test", listener);
		expect(emitter.scanListeners().length).toBe(0);
	});

	test("isSubscribed", () => {
		const emitter = new Emitter<{ test: [] }>();
		const listener = () => {};
		const listener2 = () => {};

		emitter.subscribe("test", listener);
		expect(emitter.isSubscribed("test", listener)).toBe(true);
		expect(emitter.isSubscribed("test", listener2)).toBe(false);
	});

	test("interceptors", async () => {
		const emitter = new Emitter<{ test: [number] }>({
			interceptors: {
				test: async (v) => [v + 1],
			},
		});

		const listener = (v: number) => v;
		emitter.subscribe("test", listener);

		const p = emitter.subscribeOnce("test");
		emitter.emit("test", [1]);
		expect(p).resolves.toEqual([2]);
	});

	test("collectable", async () => {
		const emitter = new Emitter<{ test: [number] }>();

		await emitter.emit("test", [1], true);
		await emitter.emit("test", [2], true);
		expect(emitter.scanListeners().length).toBe(0);

		const p1 = await emitter.subscribeOnce("test", true);
		expect(p1).toEqual([1]);

		const p2 = await emitter.subscribeOnce("test", true);
		expect(p2).toEqual([2]);

		expect(emitter.scanListeners().length).toBe(0);
	});
});
