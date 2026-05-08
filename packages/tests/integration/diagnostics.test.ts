import { describe, expect, test } from "bun:test";
import { applyDiagnostics, type Diagnostic, RecordId } from "surrealdb";
import { resetIncrementalID } from "../../sdk/src/internal/get-incremental-id";
import { createSurreal, getEngines, type Person, proto } from "./__helpers__";

function sanitizeEvents(events: Diagnostic[]) {
    return events.map((event) => {
        const { key: _key, ...rest } = event as Record<string, unknown>;
        const withoutDuration = "duration" in rest
            ? (({ duration: _d, ...r }) => r)(rest as Record<string, unknown>)
            : rest;
        const result = withoutDuration.result as Record<string, unknown> | undefined;
        if (result?.chunk) {
            const chunk = result.chunk as Record<string, unknown>;
            const stats = chunk.stats as Record<string, unknown> | undefined;
            if (stats?.duration !== undefined) {
                const { duration: _sd, ...statsRest } = stats;
                return {
                    ...withoutDuration,
                    result: { ...result, chunk: { ...chunk, stats: statsRest } },
                };
            }
        }
        return withoutDuration;
    });
}

describe("diagnostics", async () => {
    test("diagnostic events", async () => {
        const events: Diagnostic[] = [];

        const engines = await getEngines();

        const surreal = await createSurreal({
            driverOptions: {
                engines: applyDiagnostics(engines, (event) => {
                    if (event.type === "version" && event.phase === "after" && event.success) {
                        return;
                    }

                    events.push(event);
                }),
            },
        });

        await surreal.version();

        resetIncrementalID();

        await surreal.create<Person>(new RecordId("person", 1)).content({
            firstname: "John",
            lastname: "Doe",
        });

        expect(sanitizeEvents(events)).toMatchSnapshot(proto("events"));
    });

    test("extract query", async () => {
        let query = "";
        let params = {};

        const engines = await getEngines();

        const surreal = await createSurreal({
            driverOptions: {
                engines: applyDiagnostics(engines, (event) => {
                    if (event.type === "query" && event.phase === "after" && event.success) {
                        query = event.result.query;
                        params = event.result.params;
                    }
                }),
            },
        });

        resetIncrementalID();

        await surreal.create<Person>(new RecordId("test", "test")).content({
            firstname: "John",
            lastname: "Doe",
        });

        expect(query).toMatchSnapshot(proto("query"));
        expect(params).toMatchSnapshot(proto("params"));
    });
});
