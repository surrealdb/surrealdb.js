import { describe, expect, test } from "bun:test";
import { Duration } from "surrealdb";

describe("durations", () => {
	test("string equality", () => {
		expect(new Duration("1ns").toString()).toBe("1ns");
		expect(new Duration("1us").toString()).toBe("1us");
		expect(new Duration("1ms").toString()).toBe("1ms");
		expect(new Duration("1s").toString()).toBe("1s");
		expect(new Duration("1m").toString()).toBe("1m");
		expect(new Duration("1h").toString()).toBe("1h");
		expect(new Duration("1d").toString()).toBe("1d");
		expect(new Duration("1w").toString()).toBe("1w");

		// Test that toString is always as small as possible
		expect(new Duration("7d").toString()).toBe("1w");
	});

	test("components", () => {
		const dur = new Duration("1w");

		expect(dur.nanoseconds).toEqual(604800000000000);
		expect(dur.microseconds).toEqual(604800000000);
		expect(dur._milliseconds).toEqual(604800000);
		expect(dur.seconds).toEqual(604800);
		expect(dur.minutes).toEqual(10080);
		expect(dur.hours).toEqual(168);
		expect(dur.days).toEqual(7);
		expect(dur.weeks).toEqual(1);

		expect(Duration.nanoseconds(604800000000000)).toMatchObject(dur);
		expect(Duration.microseconds(604800000000)).toMatchObject(dur);
		expect(Duration.milliseconds(604800000)).toMatchObject(dur);
		expect(Duration.seconds(604800)).toMatchObject(dur);
		expect(Duration.minutes(10080)).toMatchObject(dur);
		expect(Duration.hours(168)).toMatchObject(dur);
		expect(Duration.days(7)).toMatchObject(dur);
		expect(Duration.weeks(1)).toMatchObject(dur);
	});

	test("compact", () => {
		const dur = new Duration("1w");

		expect(dur.toCompact()).toStrictEqual([604800]);
		expect(Duration.fromCompact([604800])).toMatchObject(dur);
	});
});
