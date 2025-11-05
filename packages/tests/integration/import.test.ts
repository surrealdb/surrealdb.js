import { describe, expect, test } from "bun:test";
import { createSurreal } from "./__helpers__";

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
