import { describe, expect, test } from "bun:test";
import type { Surreal, TransferProgress } from "surrealdb";
import { createSurreal, requestVersion } from "./__helpers__";

const { is2x, is3x } = await requestVersion();

async function setupExportData(surreal: Surreal) {
    await surreal.query(/* surql */ `
		CREATE foo:1 CONTENT { hello: "world" };
		CREATE bar:1 CONTENT { hello: "world" };
		DEFINE FUNCTION fn::foo() { RETURN "bar"; };
	`);
}

describe("export", async () => {
    test.if(is2x)("basic 2.x", async () => {
        const surreal = await createSurreal();
        await setupExportData(surreal);
        const res = await surreal.export();

        expect(res).toMatchSnapshot();
    });

    test.if(is3x)("basic 3.x", async () => {
        const surreal = await createSurreal();
        await setupExportData(surreal);
        const res = await surreal.export();

        expect(res).toMatchSnapshot();
    });

    test.if(is2x)("filter tables 2.x", async () => {
        const surreal = await createSurreal();
        await setupExportData(surreal);
        const res = await surreal.export({
            tables: ["foo"],
        });

        expect(res).toMatchSnapshot();
    });

    test.if(is3x)("filter tables 3.x", async () => {
        const surreal = await createSurreal();
        await setupExportData(surreal);
        const res = await surreal.export({
            tables: ["foo"],
        });

        expect(res).toMatchSnapshot();
    });

    test.if(is2x)("filter functions 2.x", async () => {
        const surreal = await createSurreal();
        await setupExportData(surreal);
        const res = await surreal.export({
            functions: true,
            tables: false,
        });

        expect(res).toMatchSnapshot();
    });

    test.if(is3x)("filter functions 3.x", async () => {
        const surreal = await createSurreal();
        await setupExportData(surreal);
        const res = await surreal.export({
            functions: true,
            tables: false,
        });

        expect(res).toMatchSnapshot();
    });

    test("response export", async () => {
        const surreal = await createSurreal();
        await setupExportData(surreal);

        const result = await surreal.export().raw();

        expect(result).toBeInstanceOf(Response);

        const text = await result.text();
        const expected = await surreal.export();

        expect(text).toBe(expected);
    });

    test("reports the progress of its download", async () => {
        const surreal = await createSurreal();
        await setupExportData(surreal);
        const events: TransferProgress[] = [];

        const text = await surreal.export().progress((progress) => events.push(progress));

        expect(events.length).toBeGreaterThan(0);
        expect(events.at(-1)?.loaded).toBe(new TextEncoder().encode(text).byteLength);
    });
});
