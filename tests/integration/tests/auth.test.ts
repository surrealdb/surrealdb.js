import { beforeAll, describe, expect, test } from "bun:test";
import { RecordId, ResponseError } from "../../../src";
import { createAuth, setupServer } from "../surreal.ts";

const { createSurreal } = await setupServer();

describe("basic auth", async () => {
	const surreal = await createSurreal();

	test("root signin", async () => {
		const res = await surreal.signin(createAuth("root"));
		expect(typeof res).toBe("string");
	});

	test("invalid credentials", async () => {
		const req = surreal.signin(createAuth("invalid"));
		expect(req).rejects.toBeInstanceOf(ResponseError);
	});
});

describe("scope auth", async () => {
	const surreal = await createSurreal();
	const version = await surreal.version();
	if (!version.startsWith("surrealdb-1")) return;

	beforeAll(async () => {
		await surreal.query(/* surql */ `
    		DEFINE TABLE user PERMISSIONS FOR select WHERE id = $auth;
    		DEFINE SCOPE user
    			SIGNUP ( CREATE type::thing('user', $id) )
    			SIGNIN ( SELECT * FROM type::thing('user', $id) );
    	`);
	});

	test("scope signup", async () => {
		const signup = await surreal.signup({
			scope: "user",
			id: 123,
		});

		expect(typeof signup).toBe("string");
	});

	test("scope signin", async () => {
		const signin = await surreal.signin({
			scope: "user",
			id: 123,
		});

		expect(typeof signin).toBe("string");
	});

	test("info", async () => {
		const info = await surreal.info<{ id: RecordId<"user"> }>();
		expect(info).toMatchObject({ id: new RecordId("user", 123) });
	});
});

describe("record auth", async () => {
	const surreal = await createSurreal();
	const version = await surreal.version();
	if (version.startsWith("surrealdb-1")) return;

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
