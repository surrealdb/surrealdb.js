import { describe, expectTypeOf, test } from "bun:test";
import {
    type Bound,
    BoundExcluded,
    BoundIncluded,
    RecordId,
    RecordIdRange,
    type RecordIdValue,
    Uuid,
} from "surrealdb";

describe("record id", () => {
    test("inferred type", () => {
        const caseString = new RecordId("table", "123");
        expectTypeOf(caseString).toExtend<RecordId>();
        expectTypeOf(caseString).toExtend<RecordId<"table", string>>();
        expectTypeOf(caseString).not.toExtend<RecordId<"table", "123">>();
        expectTypeOf(caseString.id).toExtend<RecordIdValue>();
        expectTypeOf(caseString.id).toBeString();
        expectTypeOf(caseString.id).not.toBeNumber();
        expectTypeOf(caseString.id).not.toBeBigInt();

        const caseNumber = new RecordId("table", 123);
        expectTypeOf(caseNumber).toExtend<RecordId>();
        expectTypeOf(caseNumber).toExtend<RecordId<"table", number>>();
        expectTypeOf(caseNumber).not.toExtend<RecordId<"table", 123>>();
        expectTypeOf(caseNumber.id).toExtend<RecordIdValue>();
        expectTypeOf(caseNumber.id).toBeNumber();
        expectTypeOf(caseNumber.id).not.toBeString();
        expectTypeOf(caseNumber.id).not.toBeBigInt();

        const caseBigInt = new RecordId("table", 9223372036854775807n);
        expectTypeOf(caseBigInt).toExtend<RecordId>();
        expectTypeOf(caseBigInt).toExtend<RecordId<"table", bigint>>();
        expectTypeOf(caseBigInt).not.toExtend<RecordId<"table", 9223372036854775807n>>();
        expectTypeOf(caseBigInt.id).toExtend<RecordIdValue>();
        expectTypeOf(caseBigInt.id).toBeBigInt();
        expectTypeOf(caseBigInt.id).not.toBeNumber();
        expectTypeOf(caseBigInt.id).not.toBeString();

        const caseUuid = new RecordId("table", new Uuid("d2f72714-a387-487a-8eae-451330796ff4"));
        expectTypeOf(caseUuid).toExtend<RecordId>();
        expectTypeOf(caseUuid).toExtend<RecordId<"table", Uuid>>();
        expectTypeOf(caseUuid).not.toExtend<
            RecordId<"table", "d2f72714-a387-487a-8eae-451330796ff4">
        >();
        expectTypeOf(caseUuid.id).toExtend<RecordIdValue>();
        expectTypeOf(caseUuid.id).toExtend<Uuid>();
        expectTypeOf(caseUuid.id).not.toBeNumber();
        expectTypeOf(caseUuid.id).not.toBeString();

        const caseArray = new RecordId("table", ["a", "b", "c"]);
        expectTypeOf(caseArray).toExtend<RecordId>();
        expectTypeOf(caseArray).toExtend<RecordId<"table", string[]>>();
        expectTypeOf(caseArray).not.toExtend<RecordId<"table", ["a", "b", "c"]>>();
        expectTypeOf(caseArray).not.toExtend<RecordId<"table", [string, string, string]>>();
        expectTypeOf(caseArray.id).toExtend<RecordIdValue>();
        expectTypeOf(caseArray.id).toBeArray();
        expectTypeOf(caseArray.id).not.toBeNumber();
        expectTypeOf(caseArray.id).not.toBeBigInt();
        expectTypeOf(caseArray.id).not.toBeString();

        const caseObject = new RecordId("table", { a: 1, b: 2, c: 3 });
        expectTypeOf(caseObject).toExtend<RecordId>();
        expectTypeOf(caseObject).toExtend<RecordId<"table", { a: number; b: number; c: number }>>();
        expectTypeOf(caseObject).not.toExtend<RecordId<"table", { a: 1; b: 2; c: 3 }>>();
        expectTypeOf(caseObject.id).toExtend<RecordIdValue>();
        expectTypeOf(caseObject.id).toBeObject();
        expectTypeOf(caseObject.id).toMatchObjectType<{ a: number; b: number; c: number }>();
        expectTypeOf(caseObject.id).not.toBeNumber();
        expectTypeOf(caseObject.id).not.toBeBigInt();
        expectTypeOf(caseObject.id).not.toBeString();
    });

    test("explicit type", () => {
        new RecordId<"table", string>("table", "123");
        new RecordId<"table", number>("table", 123);
        new RecordId<"table", bigint>("table", 9223372036854775807n);
        new RecordId<"table", Uuid>("table", new Uuid("d2f72714-a387-487a-8eae-451330796ff4"));
        new RecordId<"table", string[]>("table", ["a", "b", "c"]);
        new RecordId<"table", { a: number; b: number; c: number }>("table", { a: 1, b: 2, c: 3 });
        new RecordId<"table", Record<string, number>>("table", { a: 1, b: 2, c: 3 });
        new RecordId<"table", Record<string, string>>("table", { a: "1", b: "2", c: "3" });
        new RecordId<"table", Record<string, any>>("table", { a: 1, b: "2", c: true });
        // @ts-expect-error
        new RecordId<"table", string>("table", 123);
        // @ts-expect-error
        new RecordId<"table", number>("table", "123");
        // @ts-expect-error
        new RecordId<"table", bigint>("table", "123");
        // @ts-expect-error
        new RecordId<"table", Uuid>("table", "123");
        // @ts-expect-error
        new RecordId<"table", string[]>("table", { a: 1, b: 2, c: 3 });
        // @ts-expect-error
        new RecordId<"table", Record<string, string>>("table", { a: 1, b: 2, c: 3 });
        // @ts-expect-error
        new RecordId<"table", [string, string]>("table", ["a", 1]);
        // @ts-expect-error
        new RecordId<"table", [string, string]>("table", [123, 321]);
        // @ts-expect-error
        new RecordId<"table", [string, string]>("table", [321]);
        // @ts-expect-error
        new RecordId<"table", [string, string]>("table", []);
    });
});

describe("record id range", () => {
    test("inferred type", () => {
        const caseString = new RecordIdRange(
            "table",
            new BoundIncluded("a"),
            new BoundExcluded("z"),
        );
        expectTypeOf(caseString).toExtend<RecordIdRange>();
        expectTypeOf(caseString).toExtend<RecordIdRange<"table", string>>();
        expectTypeOf(caseString).not.toExtend<RecordIdRange<"table", "a">>();
        expectTypeOf(caseString.begin).toExtend<Bound<RecordIdValue>>();
        expectTypeOf(caseString.begin).toExtend<Bound<string>>();
        expectTypeOf(caseString.begin).not.toExtend<Bound<number>>();
        expectTypeOf(caseString.begin).not.toExtend<Bound<bigint>>();
        expectTypeOf(caseString.end).toExtend<Bound<string>>();
        expectTypeOf(caseString.end).not.toExtend<Bound<number>>();
        expectTypeOf(caseString.end).not.toExtend<Bound<bigint>>();

        const caseNumber = new RecordIdRange(
            "table",
            new BoundIncluded(123),
            new BoundExcluded(321),
        );
        expectTypeOf(caseNumber).toExtend<RecordIdRange>();
        expectTypeOf(caseNumber).toExtend<RecordIdRange<"table", number>>();
        expectTypeOf(caseNumber).not.toExtend<RecordIdRange<"table", 123>>();
        expectTypeOf(caseNumber.begin).toExtend<Bound<RecordIdValue>>();
        expectTypeOf(caseNumber.begin).toExtend<Bound<number>>();
        expectTypeOf(caseNumber.begin).not.toExtend<Bound<string>>();
        expectTypeOf(caseNumber.begin).not.toExtend<Bound<bigint>>();
        expectTypeOf(caseNumber.end).toExtend<Bound<number>>();
    });

    test("explicit type", () => {
        new RecordIdRange<"table", string>("table", new BoundIncluded("a"), new BoundExcluded("z"));
        new RecordIdRange<"table", number>("table", new BoundIncluded(123), new BoundExcluded(321));
        new RecordIdRange<"table", bigint>(
            "table",
            new BoundIncluded(9223372036854775807n),
            new BoundExcluded(18446744073709551615n),
        );
        // @ts-expect-error
        new RecordIdRange<"table", string>("table", new BoundIncluded(123), new BoundExcluded("z"));
        // @ts-expect-error
        new RecordIdRange<"table", number>("table", new BoundIncluded("a"), new BoundExcluded(321));
        new RecordIdRange<"table", bigint>(
            "table",
            // @ts-expect-error
            new BoundIncluded("a"),
            new BoundExcluded(18446744073709551615n),
        );
        // @ts-expect-error
        new RecordIdRange<"table", string>("table", new BoundIncluded(123), new BoundExcluded(321));
    });
});
