import { describe, expect, test } from "bun:test";
import { Features, type TransferProgress } from "surrealdb";
import { createSurreal, SURREAL_BACKEND } from "./__helpers__";

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
});
