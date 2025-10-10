import { beforeAll, describe, expect, test } from "bun:test";
import { compareVersions } from "compare-versions";
import { fetchVersion, setupServer } from "./__helpers__";

const { createSurreal } = await setupServer();

beforeAll(async () => {
    const surreal = await createSurreal();

    await surreal.query(/* surql */ `
		CREATE foo:1 CONTENT { hello: "world" };
		CREATE bar:1 CONTENT { hello: "world" };
		DEFINE FUNCTION fn::foo() { RETURN "bar"; };
	`);
});

describe("export", async () => {
    const surreal = await createSurreal();
    const version = await fetchVersion(surreal);
    const is3x = compareVersions(version, "3.0.0-alpha.1") >= 0;
    const is2x = compareVersions(version, "3.0.0-alpha.1") < 0;

    test.if(is2x)("basic 2.x", async () => {
        const res = await surreal.export();

        expect(res).toMatchSnapshot();
    });

    test.if(is3x)("basic 3.x", async () => {
        const res = await surreal.export();

        expect(res).toMatchSnapshot();
    });

    test.if(is2x)("filter tables 2.x", async () => {
        const res = await surreal.export({
            tables: ["foo"],
        });

        expect(res).toMatchSnapshot();
    });

    test.if(is3x)("filter tables 3.x", async () => {
        const res = await surreal.export({
            tables: ["foo"],
        });

        expect(res).toMatchSnapshot();
    });

    test.if(is2x)("filter functions 2.x", async () => {
        const res = await surreal.export({
            functions: true,
            tables: false,
        });

        expect(res).toMatchSnapshot();
    });

    test.if(is3x)("filter functions 3.x", async () => {
        const res = await surreal.export({
            functions: true,
            tables: false,
        });

        expect(res).toMatchSnapshot();
    });
});
