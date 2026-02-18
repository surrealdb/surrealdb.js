import { beforeEach, describe, expect, test } from "bun:test";
import { createSurreal, requestVersion } from "./__helpers__";

const { is2x, is3x } = await requestVersion();

beforeEach(async () => {
    const surreal = await createSurreal();

    await surreal.query(/* surql */ `
		CREATE foo:1 CONTENT { hello: "world" };
		CREATE bar:1 CONTENT { hello: "world" };
		DEFINE FUNCTION fn::foo() { RETURN "bar"; };
	`);
});

describe("export", async () => {
    test.if(is2x)("basic 2.x", async () => {
        const surreal = await createSurreal();
        const res = await surreal.export();

        expect(res).toMatchSnapshot();
    });

    test.if(is3x)("basic 3.x", async () => {
        const surreal = await createSurreal();
        const res = await surreal.export();

        expect(res).toMatchSnapshot();
    });

    test.if(is2x)("filter tables 2.x", async () => {
        const surreal = await createSurreal();
        const res = await surreal.export({
            tables: ["foo"],
        });

        expect(res).toMatchSnapshot();
    });

    test.if(is3x)("filter tables 3.x", async () => {
        const surreal = await createSurreal();
        const res = await surreal.export({
            tables: ["foo"],
        });

        expect(res).toMatchSnapshot();
    });

    test.if(is2x)("filter functions 2.x", async () => {
        const surreal = await createSurreal();
        const res = await surreal.export({
            functions: true,
            tables: false,
        });

        expect(res).toMatchSnapshot();
    });

    test.if(is3x)("filter functions 3.x", async () => {
        const surreal = await createSurreal();
        const res = await surreal.export({
            functions: true,
            tables: false,
        });

        expect(res).toMatchSnapshot();
    });
});
