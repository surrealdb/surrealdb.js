import { describe, expect, test } from "bun:test";
import type { QueryChunk } from "surrealdb";
import { Table } from "surrealdb";
import type { ConnectionController } from "../../../../sdk/src/controller";
import { DEFAULT_RETRY_OPTIONS } from "../../../../sdk/src/internal/retry";
import { Query } from "../../../../sdk/src/query/query";
import { SelectPromise } from "../../../../sdk/src/query/select";
import { BoundQuery } from "../../../../sdk/src/utils/bound-query";

/** A connection which records the options each query is handed to the engine with. */
function recording() {
    const seen: { stream?: boolean; signal?: AbortSignal }[] = [];

    const connection = {
        retry: DEFAULT_RETRY_OPTIONS,
        ready: async () => {},
        query: (
            _query: BoundQuery,
            _session: unknown,
            _txn: unknown,
            options?: { stream?: boolean; signal?: AbortSignal },
        ) => {
            seen.push(options ?? {});

            return (async function* (): AsyncGenerator<QueryChunk<unknown>> {
                yield { query: 0, batch: 0, kind: "batched-final", result: [{ n: 1 }] };
            })();
        },
    } as unknown as ConnectionController;

    return { connection, seen };
}

function queryOver(connection: ConnectionController): Query {
    return new Query(connection, {
        query: new BoundQuery("SELECT * FROM person"),
        transaction: undefined,
        session: undefined,
        json: false,
    });
}

async function drain(iterable: AsyncIterable<unknown>): Promise<void> {
    for await (const _ of iterable) {
        // Reading is the point.
    }
}

describe("asking for a stream", () => {
    test("stream() asks the engine for one, and nothing else does", async () => {
        const { connection, seen } = recording();

        await queryOver(connection).collect();
        await queryOver(connection).responses();
        await drain(queryOver(connection).stream());

        expect(seen.map((options) => options.stream === true)).toEqual([false, false, true]);
    });

    test("is still asked for when the query is also abandoned by a signal", async () => {
        const { connection, seen } = recording();

        await drain(queryOver(connection).signal(AbortSignal.timeout(60_000)).stream());

        expect(seen).toHaveLength(1);
        expect(seen[0]?.stream).toBe(true);
        expect(seen[0]?.signal).toBeDefined();
    });

    test("a builder's stream() asks for one, as the query it builds does", async () => {
        const { connection, seen } = recording();

        const select = new SelectPromise(connection, {
            what: new Table("person"),
            transaction: undefined,
            session: undefined,
            json: false,
        });

        await select;
        await drain(select.stream());

        expect(seen.map((options) => options.stream === true)).toEqual([false, true]);
    });
});
