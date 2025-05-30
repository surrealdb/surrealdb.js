import { describe, expect, test, beforeAll, mock } from "bun:test";
import { type AnyAuth, RecordId, ResponseError } from "surrealdb";
import { createAuth, setupServer } from "./__helpers__";

const { createSurreal } = await setupServer();

beforeAll(async () => {
	const surreal = await createSurreal();

	await surreal.query(/* surql */ `
		DEFINE TABLE user PERMISSIONS FOR select WHERE id = $auth;
		DEFINE ACCESS user ON DATABASE TYPE RECORD
			SIGNUP ( CREATE type::thing('user', $id) )
			SIGNIN ( SELECT * FROM type::thing('user', $id) )
			DURATION FOR TOKEN 61s;
	`);

	surreal.close();
});

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

	test("record signup", async () => {
		const signup = await surreal.signup({
			access: "user",
			variables: { id: 123 },
		});

		expect(typeof signup).toBe("string");
	});

	test("record signin", async () => {
		const mockHandler = mock(() => {});

		surreal.subscribe("authenticated", mockHandler);

		const signin = await surreal.signin({
			access: "user",
			variables: { id: 123 },
		});

		expect(typeof signin).toBe("string");
		expect(mockHandler).toBeCalledTimes(1);
	});

	test("info", async () => {
		const info = await surreal.info<{ id: RecordId<"user"> }>();
		expect(info).toMatchObject({ id: new RecordId("user", 123) });
	});

	test("invalidate", async () => {
		const mockHandler = mock(() => {});

		surreal.subscribe("invalidated", mockHandler);

		await surreal.invalidate();

		expect(mockHandler).toBeCalledTimes(1);
	});
});

describe("token refresh", async () => {
	const surreal = await createSurreal({
		renewAccess: true,
	});

	test("renew", async () => {
		const mockHandler = mock(() => {});

		surreal.subscribe("authenticated", mockHandler);

		await surreal.signup({
			access: "user",
			variables: { id: 456 },
		});

		// Wait at least 1s for token to renew
		await Bun.sleep(1500);

		// Once for signup, once for renew
		expect(mockHandler).toBeCalledTimes(2);
	});
});
