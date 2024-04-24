import { assertRejects } from "https://deno.land/std@0.223.0/assert/assert_rejects.ts";
import { createAuth } from "../surreal.ts";
import { createSurreal } from "../surreal.ts";

import { assertEquals } from "https://deno.land/std@0.223.0/assert/mod.ts";
import { RecordId, ResponseError } from "../../../mod.ts";
import { flatten } from "../../../src/library/flatten.ts";

Deno.test("root signin", async () => {
	const surreal = await createSurreal();

	const res = await surreal.signin(createAuth("root")).catch(() => false);
	assertEquals(typeof res, "string", "Returned token to be string");

	await surreal.close();
});

Deno.test("invalid credentials", async () => {
	const surreal = await createSurreal();

	const req = () => surreal.signin(createAuth("invalid"));
	await assertRejects(req, ResponseError);

	await surreal.close();
});

Deno.test("scope signup/signin/info", async () => {
	const surreal = await createSurreal();

	await surreal.query(/* surql */ `
			DEFINE TABLE user PERMISSIONS FOR select WHERE id = $auth;
			DEFINE SCOPE user
				SIGNUP ( CREATE type::thing('user', $id) )
				SIGNIN ( SELECT * FROM type::thing('user', $id) );
		`);

	{
		const signup = await surreal.signup({
			scope: "user",
			id: 123,
		});

		assertEquals(typeof signup, "string", "scope signin");
	}

	{
		const signin = await surreal.signin({
			scope: "user",
			id: 123,
		});

		assertEquals(typeof signin, "string", "scope signin");
	}

	{
		const info = await surreal.info<{ id: RecordId<"user"> }>();
		assertEquals(info, { id: new RecordId("user", 123) }, "scope info");
	}

	await surreal.close();
});
Deno.test("scope signup/signin/info - flatMode", async () => {
	const surreal = await createSurreal({ flatMode: true });

	await surreal.query(/* surql */ `
			DEFINE TABLE user PERMISSIONS FOR select WHERE id = $auth;
			DEFINE SCOPE user
				SIGNUP ( CREATE type::thing('user', $id) )
				SIGNIN ( SELECT * FROM type::thing('user', $id) );
		`);

	{
		const signup = await surreal.signup({
			scope: "user",
			id: 1234,
		});

		assertEquals(typeof signup, "string", "scope signin");
	}

	{
		const signin = await surreal.signin({
			scope: "user",
			id: 1234,
		});

		assertEquals(typeof signin, "string", "scope signin");
	}

	{
		const info = await surreal.info<{ id: RecordId<"user"> }>();
		assertEquals(
			info,
			flatten({ id: new RecordId("user", 1234) }),
			"scope info",
		);
	}

	await surreal.close();
});
