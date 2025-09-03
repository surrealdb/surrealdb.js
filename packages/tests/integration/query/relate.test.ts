import { beforeEach, describe, expect, test } from "bun:test";
import { RecordId } from "surrealdb";
import { resetIncrementalID } from "../../../sdk/src/internal/get-incremental-id";
import { graphTable, setupServer } from "../__helpers__";

const { createSurreal } = await setupServer();

beforeEach(async () => {
    resetIncrementalID();
});

type Edge = {
    id: RecordId<"graph">;
    in: RecordId<"edge">;
    out: RecordId<"edge">;
    num: number;
};

describe("relate()", async () => {
    const surreal = await createSurreal();
    const { version } = await surreal.version();
    const skip = version === "surrealdb-1.4.2";

    test.skipIf(skip)("single with id", async () => {
        const single: Edge = await surreal.relate(
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
        const single: Edge = await surreal.relate(
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
        const from = [new RecordId("edge", "in1")];
        const to = [new RecordId("edge", "out1"), new RecordId("edge", "out2")];

        const multiple: Edge[] = await surreal.relate(from, graphTable, to);

        expect(multiple).toBeArrayOfSize(2);
    });

    test.skipIf(skip)("compile", async () => {
        const builder = surreal.relate(
            new RecordId("edge", "in"),
            graphTable,
            new RecordId("edge", "out"),
        );

        const { query, bindings } = builder.compile();

        expect(query).toMatchSnapshot();
        expect(bindings).toMatchSnapshot();
    });
});
