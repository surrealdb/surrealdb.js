import { beforeAll, describe, expect, test } from "bun:test";
import { type AnyAuth, RecordId, ResponseError } from "surrealdb";
import { createAuth, setupServer } from "./__helpers__";

const { createSurreal } = await setupServer();

describe("system auth", async () => {
	const surreal = await createSurreal();

	test("root signin", async () => {
		const res = await surreal.signin(createAuth("root") as AnyAuth);
		expect(typeof res).toBe("string");
	});

	test("invalid credentials", async () => {
		const req = surreal.signin(createAuth("invalid") as AnyAuth);
		expect(req).rejects.toBeInstanceOf(ResponseError);
	});
});

describe("record auth", async () => {
	const surreal = await createSurreal();

	beforeAll(async () => {
		await surreal.query(/* surql */ `
    		DEFINE TABLE user PERMISSIONS FOR select WHERE id = $auth;
    		DEFINE ACCESS user ON DATABASE TYPE RECORD
    			SIGNUP ( CREATE type::thing('user', $id) )
    			SIGNIN ( SELECT * FROM type::thing('user', $id) );
    	`);
	});

	test("record signup", async () => {
		const signup = await surreal.signup({
			access: "user",
			variables: { id: 123 },
		});

		expect(typeof signup).toBe("string");
	});

	test("record signin", async () => {
		const signin = await surreal.signin({
			access: "user",
			variables: { id: 123 },
		});

		expect(typeof signin).toBe("string");
	});

	test("info", async () => {
		const info = await surreal.info<{ id: RecordId<"user"> }>();
		expect(info).toMatchObject({ id: new RecordId("user", 123) });
	});
});
