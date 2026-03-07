import { describe, expect, test } from "bun:test";
import { Features } from "surrealdb";
import { createSurreal } from "./__helpers__";

describe("import", async () => {
    test("basic", async () => {
        const surreal = await createSurreal();

        await surreal.import(/* surql */ `
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

        const blob = new Blob(["CREATE trip:1 CONTENT { msg: 'hello' };"]);
        await surreal.import(blob);

        const [records] = await surreal.query(/* surql */ `SELECT * FROM trip`);

        expect(records).toHaveLength(1);
    });
});
