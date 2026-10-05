import { describe, expect, test } from "bun:test";
import { DateTime, Duration, ExpressionError, RecordId } from "surrealdb";
import { createSurreal, graphTable, proto } from "../__helpers__";

type Edge = {
    id: RecordId<"graph">;
    in: RecordId<"edge">;
    out: RecordId<"edge">;
    num: number;
};

describe("relate()", async () => {
    const checkSurreal = await createSurreal();
    const { version } = await checkSurreal.version();
    const skip = version === "surrealdb-1.4.2";

    test.skipIf(skip)("single with id", async () => {
        const surreal = await createSurreal();
        const single = await surreal.relate<Edge>(
            new RecordId("edge", "in"),
            new RecordId("graph", 1),
            new RecordId("edge", "out"),
            {
                num: 123,
            },
        );

        expect(single.in).toStrictEqual(new RecordId("edge", "in"));
        expect(single.id).toStrictEqual(new RecordId("graph", 1));
        expect(single.out).toStrictEqual(new RecordId("edge", "out"));
        expect(single.num).toStrictEqual(123);
    });

    test.skipIf(skip)("single with table", async () => {
        const surreal = await createSurreal();
        const single = await surreal.relate<Edge>(
            new RecordId("edge", "in"),
            graphTable,
            new RecordId("edge", "out"),
            {
                num: 123,
            },
        );

        expect(single.in).toStrictEqual(new RecordId("edge", "in"));
        expect(single.id.table).toStrictEqual(graphTable);
        expect(single.out).toStrictEqual(new RecordId("edge", "out"));
        expect(single.num).toStrictEqual(123);
    });

    test.skipIf(skip)("multiple", async () => {
        const surreal = await createSurreal();
        const from = [new RecordId("edge", "in1")];
        const to = [new RecordId("edge", "out1"), new RecordId("edge", "out2")];

        const multiple = await surreal.relate<Edge>(from, graphTable, to);

        expect(multiple).toBeArrayOfSize(2);
    });

    test.skipIf(skip)("compile", async () => {
        const surreal = await createSurreal();
        const builder = surreal
            .relate(new RecordId("edge", "in"), graphTable, new RecordId("edge", "out"))
            .unique()
            .output("diff")
            .timeout(Duration.seconds(1));

        const { query, bindings } = builder.compile();

        expect(query).toMatchSnapshot(proto("query"));
        expect(bindings).toMatchSnapshot(proto("bindings"));
    });

    // SurrealDB has no VERSION clause for RELATE statements
    test.skipIf(skip)("version() is not supported", async () => {
        const surreal = await createSurreal();
        const builder = surreal
            .relate(new RecordId("edge", "in"), graphTable, new RecordId("edge", "out"))
            .version(new DateTime(0));

        expect(() => builder.compile()).toThrow(ExpressionError);
        expect(() => builder.compile()).toThrow("VERSION clause is not supported by RELATE");
        await expect(Promise.resolve(builder)).rejects.toThrow(ExpressionError);
    });
});
