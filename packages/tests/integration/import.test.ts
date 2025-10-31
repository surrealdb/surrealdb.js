import { describe, expect, test } from "bun:test";
import { setupServer } from "./__helpers__";

const { createSurreal } = await setupServer();

describe("import", async () => {
    const surreal = await createSurreal();

    test("basic", async () => {
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
});
