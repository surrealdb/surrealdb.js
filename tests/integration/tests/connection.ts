import { assertInstanceOf } from "https://deno.land/std@0.223.0/assert/assert_instance_of.ts";
import { createSurreal } from "../surreal.ts";
import { assertEquals } from "https://deno.land/std@0.223.0/assert/mod.ts";
import { VersionRetrievalFailure } from "../../../mod.ts";
import { assertLess } from "https://deno.land/std@0.223.0/assert/assert_less.ts";

Deno.test("check version", async () => {
	const surreal = await createSurreal();
	const res = await surreal.version();

	assertEquals(res.startsWith("surrealdb-"), true, "Version to be returned");

	await surreal.close();
});

Deno.test("version check timeout", async () => {
	const start = new Date();
	const res = await createSurreal({ reachable: false }).catch((err) => err);
	const end = new Date();
	const diff = end.getTime() - start.getTime();

	assertInstanceOf(res, VersionRetrievalFailure);
	assertLess(diff, 5100); // 100ms margin
});
