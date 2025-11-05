import { describe, expect, test } from "bun:test";
import { InvalidDateError, RecordId } from "surrealdb";
import { createSurreal, testTable } from "./__helpers__";

describe("data integrity", async () => {
    test("invalid date", async () => {
        const surreal = await createSurreal();

        const invalid = new Date(NaN);

        const execute = async () => {
            await surreal.create(new RecordId("foo", 1)).content({
                date: invalid,
            });
        };

        expect(execute()).rejects.toThrow(InvalidDateError);
    });

    test("NaN number handling", async () => {
        const surreal = await createSurreal();
        const id = new RecordId("test", "nan");

        type Result = {
            value: number;
            nested: {
                nan: number;
                regular: number;
            };
            array: number[];
        };

        // Insert data with NaN
        const record = await surreal.create<Result>(id).content({
            value: NaN,
            nested: {
                nan: NaN,
                regular: 42,
            },
            array: [NaN, 1, 2, NaN],
        });

        // NaN should be preserved or handled consistently
        expect(record.value).toBeNaN();
        expect(record.nested.nan).toBeNaN();
        expect(record.nested.regular).toBe(42);
        expect(record.array[0]).toBeNaN();
        expect(record.array[1]).toBe(1);
        expect(record.array[2]).toBe(2);
        expect(record.array[3]).toBeNaN();
    });

    test("Infinity number handling", async () => {
        const surreal = await createSurreal();
        const id = new RecordId("test", "infinity");

        type Result = {
            positiveInfinity: number;
            negativeInfinity: number;
            mixed: {
                pos: number;
                neg: number;
                zero: number;
            };
            array: number[];
        };

        const record = await surreal.create<Result>(id).content({
            positiveInfinity: Infinity,
            negativeInfinity: -Infinity,
            mixed: {
                pos: Infinity,
                neg: -Infinity,
                zero: 0,
            },
            array: [Infinity, -Infinity, 0, 42],
        });

        expect(record.positiveInfinity).toBe(Infinity);
        expect(record.negativeInfinity).toBe(-Infinity);
        expect(record.mixed.pos).toBe(Infinity);
        expect(record.mixed.neg).toBe(-Infinity);
        expect(record.mixed.zero).toBe(0);
    });

    test("large numbers", async () => {
        const surreal = await createSurreal();

        // Large integer
        type Result1 = {
            largeNumber: number;
        };

        const [record1] = await surreal.create<Result1>(testTable).content({
            largeNumber: Number.MAX_SAFE_INTEGER,
        });

        expect(record1.largeNumber).toBe(Number.MAX_SAFE_INTEGER);

        // Large bigint
        type Result2 = {
            largeNumber: bigint;
        };

        const [record2] = await surreal.create<Result2>(testTable).content({
            largeNumber: 1844674407370955161n,
        });

        expect(record2.largeNumber).toBe(1844674407370955161n);

        // Too large bigint
        type Result3 = {
            largeNumber: bigint;
        };

        const task = async () => {
            await surreal.create<Result3>(testTable).content({
                largeNumber: 999999999999999999999n,
            });
        };

        expect(task()).rejects.toThrow();
    });

    test("very small numbers", async () => {
        const surreal = await createSurreal();
        const id = new RecordId("test", "small");

        const smallNumber = Number.MIN_SAFE_INTEGER;
        const tinyNumber = Number.EPSILON;

        type Result = {
            minSafeInteger: number;
            epsilon: number;
            verySmall: number;
            negativeSmall: number;
            array: number[];
        };

        await surreal.create<Result>(id).content({
            minSafeInteger: smallNumber,
            epsilon: tinyNumber,
            verySmall: 0.0000000000000001,
            negativeSmall: -0.0000000000000001,
        });

        const result = await surreal.select<Result>(id);

        expect(result).toBeDefined();
        expect(result?.minSafeInteger).toBe(smallNumber);
        expect(result?.epsilon).toBe(tinyNumber);
    });

    test("zero and negative zero", async () => {
        const surreal = await createSurreal();
        const id = new RecordId("test", "zero");

        type Result = {
            zero: number;
            negativeZero: number;
            array: number[];
        };

        await surreal.create<Result>(id).content({
            zero: 0,
            negativeZero: -0,
            array: [0, -0, 0.0],
        });

        const result = await surreal.select<Result>(id);

        expect(result).toBeDefined();
        expect(result?.zero).toBe(0);

        // Note: -0 and 0 are considered equal in JavaScript but have different representations
        // The database might normalize this
        if (Array.isArray(result?.array)) {
            result.array.forEach((val) => {
                expect(val === 0 || Object.is(val, -0)).toBe(true);
            });
        }
    });

    test("null and undefined", async () => {
        const surreal = await createSurreal();
        const id = new RecordId("test", "nullish");

        type Result = {
            nullValue: null;
            undefinedValue: undefined;
            nested: {
                null: null;
                undefined: undefined;
                mixed: (null | undefined | string)[];
            };
        };

        await surreal.create<Result>(id).content({
            nullValue: null,
            undefinedValue: undefined,
            nested: {
                null: null,
                undefined: undefined,
                mixed: [null, undefined, "value"],
            },
        });

        const result = await surreal.select<Result>(id);

        expect(result).toBeDefined();
        expect(result?.nullValue).toBe(null);

        // undefined may be omitted or converted to null
        if (result?.nested && typeof result.nested === "object" && result.nested !== null) {
            expect((result.nested as { null?: unknown }).null).toBe(null);
        }
    });
});
