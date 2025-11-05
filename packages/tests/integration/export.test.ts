import { beforeEach, describe, expect, test } from "bun:test";
import { satisfies } from "compare-versions";
import { createSurreal, requestVersion } from "./__helpers__";

const version = await requestVersion();
const is3x = satisfies(version, ">=3.0.0-alpha.1");
const is2x = satisfies(version, ">=2.1.0 <3.0.0-alpha.1");

beforeEach(async () => {
    const surreal = await createSurreal();

    await surreal.query(/* surql */ `
		CREATE foo:1 CONTENT { hello: "world" };
		CREATE bar:1 CONTENT { hello: "world" };
		DEFINE FUNCTION fn::foo() { RETURN "bar"; };
	`);
});

describe("export", async () => {
    const surreal = await createSurreal();

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
