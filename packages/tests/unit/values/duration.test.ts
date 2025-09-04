import { describe, expect, test } from "bun:test";
import fc from "fast-check";
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

        // Normalization to smallest units
        expect(new Duration("7d").toString()).toBe("1w");
        expect(new Duration("60s").toString()).toBe("1m");
        expect(new Duration("1000ms").toString()).toBe("1s");
        expect(new Duration("1000000us").toString()).toBe("1s");
        expect(new Duration("1000000000ns").toString()).toBe("1s");
    });

    test("component getters and constructors", () => {
        const dur = new Duration("1w");

        expect(dur.nanoseconds).toEqual(604800000000000n);
        expect(dur.microseconds).toEqual(604800000000n);
        expect(dur.milliseconds).toEqual(604800000n);
        expect(dur.seconds).toEqual(604800n);
        expect(dur.minutes).toEqual(10080n);
        expect(dur.hours).toEqual(168n);
        expect(dur.days).toEqual(7n);
        expect(dur.weeks).toEqual(1n);

        expect(Duration.nanoseconds(604800000000000)).toMatchObject(dur);
        expect(Duration.microseconds(604800000000)).toMatchObject(dur);
        expect(Duration.milliseconds(604800000)).toMatchObject(dur);
        expect(Duration.seconds(604800)).toMatchObject(dur);
        expect(Duration.minutes(10080)).toMatchObject(dur);
        expect(Duration.hours(168)).toMatchObject(dur);
        expect(Duration.days(7)).toMatchObject(dur);
        expect(Duration.weeks(1)).toMatchObject(dur);
    });

    test("bigint duration", () => {
        const dur = Duration.milliseconds(28382400000000000n);
        expect(dur.milliseconds).toEqual(28382400000000000n);
        expect(dur.toString()).toEqual("46928571w3d");
    });

    test("compact and fromCompact", () => {
        const dur = new Duration("1s");
        expect(dur.toCompact()).toStrictEqual([1n]);
        expect(new Duration([1n])).toMatchObject(dur);

        const dur2 = new Duration("1s500ms");
        expect(dur2.toCompact()).toStrictEqual([1n, 500000000n]);
        expect(new Duration([1n, 500000000n])).toMatchObject(dur2);
    });

    test("equality", () => {
        expect(new Duration("1s").equals(new Duration("1000ms"))).toBe(true);
        expect(new Duration("1s").equals(new Duration("1s500ms"))).toBe(false);
    });

    test("add", () => {
        const a = new Duration("1s");
        const b = new Duration("500ms");
        expect(a.add(b)).toMatchObject(new Duration("1s500ms"));

        const c = new Duration("750ms");
        const d = new Duration("500ms");
        expect(c.add(d)).toMatchObject(new Duration("1s250ms"));
    });

    test("sub", () => {
        const a = new Duration("2s");
        const b = new Duration("500ms");
        expect(a.sub(b)).toMatchObject(new Duration("1s500ms"));

        const c = new Duration("1s250ms");
        const d = new Duration("500ms");
        expect(c.sub(d)).toMatchObject(new Duration("750ms"));
    });

    test("mul", () => {
        const a = new Duration("1s500ms");
        expect(a.mul(2)).toMatchObject(new Duration("3s"));

        const b = new Duration("250ms");
        expect(b.mul(4)).toMatchObject(new Duration("1s"));
    });

    test("div", () => {
        const a = new Duration("3s");
        expect(a.div(2)).toMatchObject(new Duration("1s500ms"));

        const b = new Duration("5s");
        const c = new Duration("2s");
        expect(b.div(c)).toEqual(2n); // 5s / 2s = 2
    });

    test("mod", () => {
        const a = new Duration("5s");
        const b = new Duration("2s");
        expect(a.mod(b)).toMatchObject(new Duration("1s"));

        const c = new Duration("7s500ms");
        const d = new Duration("2s");
        expect(c.mod(d)).toMatchObject(new Duration("1s500ms"));
    });

    test("normalization", () => {
        // 1 second + 1.5s = 2s + 500_000_000ns after normalization
        const dur = new Duration([1n, 1_500_000_000n]);
        expect(dur.toCompact()).toStrictEqual([2n, 500_000_000n]);
    });

    test("measure", async () => {
        const stop = Duration.measure();
        await new Promise((resolve) => setTimeout(resolve, 50));
        const elapsed = stop();
        expect(Number(elapsed.milliseconds)).toBeWithin(48, 52);
    });
});

describe("fuzzing durations", () => {
    const nsArb = fc.bigInt({ min: 0n, max: 999_999_999n });
    const durArb = fc
        .record({
            seconds: fc.bigInt({ min: 0n, max: 2n ** 63n - 1n }),
            nanoseconds: nsArb,
        })
        .map(({ seconds, nanoseconds }) => new Duration([seconds, nanoseconds]));

    test("add identity", () => {
        fc.assert(
            fc.property(durArb, (d) => {
                const zero = new Duration([0n, 0n]);
                return d.add(zero).toCompact().toString() === d.toCompact().toString();
            }),
        );
    });

    test("sub self equals zero", () => {
        fc.assert(
            fc.property(durArb, (d) => {
                const result = d.sub(d).toCompact();
                return result.length === 0 || (result[0] === 0n && (result[1] ?? 0n) === 0n);
            }),
        );
    });

    test("multiply by one", () => {
        fc.assert(
            fc.property(durArb, (d) => {
                return d.mul(1).toCompact().toString() === d.toCompact().toString();
            }),
        );
    });

    test("div by self is one (only if exact)", () => {
        fc.assert(
            fc.property(
                durArb.filter((d) => d.toCompact().length > 0),
                (d) => {
                    const [, ns = 0n] = d.toCompact();
                    if (ns === 0n) {
                        return d.div(d) === 1n;
                    }
                    return true;
                },
            ),
        );
    });

    test("mod by self is zero (only if exact)", () => {
        fc.assert(
            fc.property(
                durArb.filter((d) => d.toCompact().length > 0),
                (d) => {
                    const [, ns = 0n] = d.toCompact();
                    const result = d.mod(d).toCompact();
                    if (ns === 0n) {
                        return (
                            result.length === 0 || (result[0] === 0n && (result[1] ?? 0n) === 0n)
                        );
                    }
                    return true;
                },
            ),
        );
    });

    test("division and remainder reconstruct original (only if clean)", () => {
        fc.assert(
            fc.property(
                durArb.filter((d) => d.toCompact().length > 0),
                durArb.filter((d) => d.toCompact().length > 0),
                (a, b) => {
                    const q = a.div(b);
                    const r = a.mod(b);
                    const recon = b.mul(q).add(r);
                    return recon.toCompact().toString() === a.toCompact().toString();
                },
            ),
        );
    });
});
