import { describe, expect, test } from "bun:test";
import fc from "fast-check";
import { Decimal } from "surrealdb"; // adjust the import path as needed

describe("Decimal", () => {
    test("parses and returns high-precision values", () => {
        const input =
            "12345678901234567890123456789012345678.87654321098765432109876543210987654321";
        const dec = new Decimal(input);
        expect(dec.toString()).toBe(input);
    });

    test("basic arithmetic", () => {
        const a = new Decimal("1.00000000000000000000000000000000000001");
        const b = new Decimal("2.00000000000000000000000000000000000002");
        expect(a.add(b).toString()).toBe("3.00000000000000000000000000000000000003");
        expect(b.sub(a).toString()).toBe("1.00000000000000000000000000000000000001");
        expect(a.mul(b).toString()).toBe(
            "2.0000000000000000000000000000000000000400000000000000000000000000000000000002",
        );
        expect(b.div(a).toFixed(0)).toBe("2");
    });

    test("additional arithmetic scenarios", () => {
        const cases = [
            { a: "0", b: "1", add: "1", sub: "-1", mul: "0", div: "0", mod: "0" },
            { a: "0", b: "-1", add: "-1", sub: "1", mul: "0", div: "0", mod: "0" },
            {
                a: "0",
                b: "0.1",
                add: "0.1",
                sub: "-0.1",
                mul: "0",
                div: "0",
                mod: "0",
            },
            {
                a: "1",
                b: "0.1",
                add: "1.1",
                sub: "0.9",
                mul: "0.1",
                div: "10",
                mod: "0",
            },
            {
                a: "-1",
                b: "0.1",
                add: "-0.9",
                sub: "-1.1",
                mul: "-0.1",
                div: "-10",
                mod: "0",
            },
            {
                a: "0.00000000000000000001",
                b: "1e-20",
                add: "0.00000000000000000002",
                sub: "0",
                mul: "0.0000000000000000000000000000000000000001",
                div: "1",
                mod: "0",
            },
            {
                a: "123456789.987654321",
                b: "1",
                add: "123456790.987654321",
                sub: "123456788.987654321",
                mul: "123456789.987654321",
                div: "123456789.987654321",
                mod: "0.987654321",
            },
            {
                a: "0.1",
                b: "0.2",
                add: "0.3",
                sub: "-0.1",
                mul: "0.02",
                div: "0.5",
                mod: "0.1",
            },
        ];

        for (const { a, b, add, sub, mul, div, mod } of cases) {
            const A = new Decimal(a);
            const B = new Decimal(b);
            expect(A.add(B).toString()).toBe(add);
            expect(A.sub(B).toString()).toBe(sub);
            expect(A.mul(B).toString()).toBe(mul);
            expect(A.div(B).toString()).toBe(div);
            expect(A.mod(B).toString()).toBe(mod);
        }
    });

    test("modulo returns remainder", () => {
        const a = new Decimal("5.75");
        const b = new Decimal("2.5");
        expect(a.mod(b).toString()).toBe("0.75");
    });

    test("handles very small values", () => {
        const tiny = new Decimal("0.00000000000000000000000000000000000001");
        expect(tiny.toString()).toBe("0.00000000000000000000000000000000000001");
        const result = tiny.add(tiny);
        expect(result.toString()).toBe("0.00000000000000000000000000000000000002");
    });

    test("zero", () => {
        const zero = new Decimal("0");
        expect(zero.mul(new Decimal("1")).toString()).toBe("0");
    });

    test("serialization to JSON", () => {
        const d = new Decimal("123.456789");
        expect(JSON.stringify(d)).toBe('"123.456789"');
    });

    test("abs and neg", () => {
        const d = new Decimal("-42.5");
        expect(d.abs().toString()).toBe("42.5");
        expect(d.neg().toString()).toBe("42.5");
        expect(d.neg().neg().toString()).toBe("-42.5");
    });

    test("isZero and isNegative", () => {
        expect(new Decimal("0").isZero()).toBe(true);
        expect(new Decimal("0.000").isZero()).toBe(true);
        expect(new Decimal("-0.000").isZero()).toBe(true);
        expect(new Decimal("-1.23").isNegative()).toBe(true);
        expect(new Decimal("1.23").isNegative()).toBe(false);
    });

    test("compare", () => {
        const a = new Decimal("1.234");
        const b = new Decimal("1.23400");
        const c = new Decimal("1.235");
        expect(a.compare(b)).toBe(0);
        expect(a.compare(c)).toBe(-1);
        expect(c.compare(a)).toBe(1);
    });

    test("round", () => {
        expect(new Decimal("1.999").round(2).toFixed(2)).toBe("2.00");
        expect(new Decimal("1.994").round(2).toString()).toBe("1.99");
        expect(new Decimal("1.005").round(2).toString()).toBe("1.01");
        expect(new Decimal("-1.005").round(2).toString()).toBe("-1.01");
    });

    test("toFixed", () => {
        expect(new Decimal("1.2").toFixed(3)).toBe("1.200");
        expect(new Decimal("1.2345").toFixed(2)).toBe("1.23");
        expect(new Decimal("-1.005").toFixed(2)).toBe("-1.01");
    });

    test("toFloat, toBigInt, toParts", () => {
        const d = new Decimal("123.456");
        expect(d.toFloat()).toBeCloseTo(123.456);
        expect(d.toBigInt()).toBe(123n);
        expect(new Decimal("-1.99").toBigInt()).toBe(-2n);
        expect(d.toParts()).toEqual({ int: 123n, frac: 456n, scale: 3 });
    });

    test("toScientific", () => {
        const cases = [
            { input: "0", sci: "0e0" },
            { input: "1", sci: "1e0" },
            { input: "1000", sci: "1e3" },
            { input: "0.001", sci: "1e-3" },
            { input: "123456", sci: "1.23456e5" },
            { input: "0.00000000000000000001", sci: "1e-20" },
            { input: "123.456", sci: "1.23456e2" },
            { input: "-0.00042", sci: "-4.2e-4" },
            { input: "-987000", sci: "-9.87e5" },
        ];

        for (const { input, sci } of cases) {
            const d = new Decimal(input);
            expect(d.toScientific()).toBe(sci);
        }
    });

    test("fromScientificNotation parses correctly", () => {
        const cases = [
            { input: "1e0", expected: "1" },
            { input: "1e3", expected: "1000" },
            { input: "1.23e2", expected: "123" },
            { input: "1e-3", expected: "0.001" },
            { input: "4.2e-4", expected: "0.00042" },
            { input: "9.87e5", expected: "987000" },
            { input: "1.23456e5", expected: "123456" },
            { input: "-1e-2", expected: "-0.01" },
            { input: "-5.67e2", expected: "-567" },
        ];

        for (const { input, expected } of cases) {
            const d = Decimal.fromScientificNotation(input);
            expect(d.toString()).toBe(expected);
        }
    });

    describe("fuzzing", () => {
        const decimalStrArb = fc
            .stringMatching(/^-?\d+(\.\d+)?$/)
            .filter((s) => s.length > 0 && s.length < 80);

        const decimalArb = decimalStrArb.map((str) => new Decimal(str));

        test("add identity", () => {
            fc.assert(fc.property(decimalArb, (d) => d.add(new Decimal("0")).equals(d)));
        });

        test("sub self is zero", () => {
            fc.assert(fc.property(decimalArb, (d) => d.sub(d).isZero()));
        });

        test("mul by one", () => {
            fc.assert(fc.property(decimalArb, (d) => d.mul(new Decimal("1")).equals(d)));
        });

        test("div by self is one (nonzero)", () => {
            fc.assert(
                fc.property(
                    decimalArb.filter((d) => !d.isZero()),
                    (d) => d.div(d).toString() === "1",
                ),
            );
        });

        test("mul commutativity", () => {
            fc.assert(
                fc.property(
                    decimalArb,
                    decimalArb,
                    (a, b) => a.mul(b).toString() === b.mul(a).toString(),
                ),
            );
        });

        test("add associativity (approx)", () => {
            fc.assert(
                fc.property(decimalArb, decimalArb, decimalArb, (a, b, c) => {
                    const left = a.add(b).add(c);
                    const right = a.add(b.add(c));
                    return left.equals(right);
                }),
            );
        });

        test("mul by zero is zero", () => {
            fc.assert(fc.property(decimalArb, (d) => d.mul(new Decimal("0")).isZero()));
        });
    });
});
