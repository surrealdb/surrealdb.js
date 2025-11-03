import { beforeEach, describe, expect, test } from "bun:test";
import { applyDiagnostics, createRemoteEngines, type Diagnostic, RecordId } from "surrealdb";
import { resetIncrementalID } from "../../sdk/src/internal/get-incremental-id";
import { type Person, setupServer } from "./__helpers__";

const { createSurreal } = await setupServer();

beforeEach(() => {
    resetIncrementalID();
});

describe("diagnostics", async () => {
    test("diagnostic events", async () => {
        const events: Diagnostic[] = [];

        const surreal = await createSurreal({
            driverOptions: {
                engines: applyDiagnostics(createRemoteEngines(), (event) => {
                    // Skip the version event for test integrity
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

        expect(events).toMatchSnapshot();
    });

    test("extract query", async () => {
        let query = "";
        let params = {};

        const surreal = await createSurreal({
            driverOptions: {
                engines: applyDiagnostics(createRemoteEngines(), (event) => {
                    if (event.type === "query" && event.phase === "after" && event.success) {
                        query = event.result.query;
                        params = event.result.params;
                    }
                }),
            },
        });

        await surreal.create<Person>(new RecordId("test", "test")).content({
            firstname: "John",
            lastname: "Doe",
        });

        expect(query).toMatchSnapshot();
        expect(params).toMatchSnapshot();
    });
});
