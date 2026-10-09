import { describe, expect, test } from "bun:test";
import { satisfies } from "semver";
import { AlreadyExistsError, Features, ImportError, type TransferProgress } from "surrealdb";
import { createSurreal, requestVersion, SURREAL_BACKEND } from "./__helpers__";

const { version } = await requestVersion();
const isRemote = SURREAL_BACKEND === "remote";
const reportsFailures = satisfies(version, ">=3.1.0-0", { includePrerelease: true });

describe("import", async () => {
    test("basic", async () => {
        const surreal = await createSurreal();

        await surreal.import(/* surql */ `
			OPTION IMPORT;
			CREATE foo:1 CONTENT { hello: "world" };
		`);

        const [records] = await surreal
            .query(/* surql */ `
				SELECT * FROM foo;
			`)
            .collect();

        expect(records).toMatchSnapshot();
    });

    test("streamed import", async () => {
        const surreal = await createSurreal();

        if (!surreal.isFeatureSupported(Features.ExportImportRaw)) {
            return;
        }

        const encoder = new TextEncoder();
        const stream = new ReadableStream({
            start(controller) {
                controller.enqueue(encoder.encode("OPTION IMPORT;\n"));
                controller.enqueue(encoder.encode("CREATE trip:1 CONTENT { msg: 'hello' };"));
                controller.enqueue(encoder.encode("CREATE trip:2 CONTENT { msg: 'world' };"));
                controller.close();
            },
        });

        await surreal.import(stream);

        const [records] = await surreal.query(/* surql */ `SELECT * FROM trip`);

        expect(records).toHaveLength(2);
    });

    test("blob import", async () => {
        const surreal = await createSurreal();

        if (!surreal.isFeatureSupported(Features.ExportImportRaw)) {
            return;
        }

        const blob = new Blob(["OPTION IMPORT;\nCREATE trip:1 CONTENT { msg: 'hello' };"]);
        await surreal.import(blob);

        const [records] = await surreal.query(/* surql */ `SELECT * FROM trip`);

        expect(records).toHaveLength(1);
    });

    test.if(SURREAL_BACKEND === "remote")("reports the progress of its upload", async () => {
        const surreal = await createSurreal();
        const statements = Array.from(
            { length: 2000 },
            (_, i) => `CREATE progress:${i} CONTENT { n: ${i} };`,
        );
        const sql = `OPTION IMPORT;\n${statements.join("\n")}`;
        const size = new TextEncoder().encode(sql).byteLength;
        const events: TransferProgress[] = [];

        await surreal.import(sql).progress((progress) => events.push(progress));

        expect(events.length).toBeGreaterThan(0);
        expect(events.at(-1)).toEqual({ loaded: size, total: size });

        const [count] = await surreal.query("count(SELECT * FROM progress)").collect<[number]>();

        expect(count).toBe(2000);
    });

    test.if(isRemote && reportsFailures)("rejects with the statements which failed", async () => {
        const surreal = await createSurreal();

        const error = await surreal
            .import("OPTION IMPORT;\nCREATE dup:1;\nCREATE dup:1;\nCREATE dup:2;")
            .then(
                () => undefined,
                (error: unknown) => error,
            );

        expect(error).toBeInstanceOf(ImportError);
        expect((error as ImportError).failed).toBe(1);
        expect((error as ImportError).failures[0]).toBeInstanceOf(AlreadyExistsError);

        // The import is not transactional: the statements around the failure applied
        const [ids] = await surreal
            .query("SELECT VALUE record::id(id) FROM dup")
            .collect<[number[]]>();

        expect(ids).toEqual([1, 2]);
    });

    test.if(isRemote && reportsFailures)(
        "rejects with a failure reported by progress too",
        async () => {
            const surreal = await createSurreal();

            const error = await surreal
                .import(new Blob(["OPTION IMPORT;\nCREATE (((;"]))
                .progress(() => {})
                .then(
                    () => undefined,
                    (error: unknown) => error,
                );

            expect(error).toBeInstanceOf(ImportError);
            expect((error as ImportError).message).toContain("Parse error");
        },
    );
});
