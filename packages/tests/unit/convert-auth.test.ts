import { expect, test } from "bun:test";
import { convertAuth } from "../../packages/_legacy/src";

test("valid", () => {
	expect(convertAuth({ username: "root", password: "root" })).toStrictEqual({
		user: "root",
		pass: "root",
	});

	expect(
		convertAuth({ namespace: "test", username: "root", password: "root" }),
	).toStrictEqual({
		ns: "test",
		user: "root",
		pass: "root",
	});

	expect(
		convertAuth({
			namespace: "test",
			database: "test",
			username: "root",
			password: "root",
		}),
	).toStrictEqual({
		ns: "test",
		db: "test",
		user: "root",
		pass: "root",
	});

	expect(
		convertAuth({
			namespace: "test",
			database: "test",
			scope: "user",
			username: "root",
			password: "root",
		}),
	).toStrictEqual({
		ns: "test",
		db: "test",
		sc: "user",
		username: "root",
		password: "root",
	});

	expect(
		convertAuth({
			namespace: "test",
			database: "test",
			access: "user",
			username: "root",
			password: "root",
		}),
	).toStrictEqual({
		ns: "test",
		db: "test",
		ac: "user",
		user: "root",
		pass: "root",
	});

	expect(
		convertAuth({
			namespace: "test",
			database: "test",
			access: "user",
			variables: { username: "root", password: "root" },
		}),
	).toStrictEqual({
		ns: "test",
		db: "test",
		ac: "user",
		username: "root",
		password: "root",
	});
});
