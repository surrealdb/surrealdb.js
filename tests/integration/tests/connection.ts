import { createSurreal } from "../surreal.ts";
import { assertEquals } from "https://deno.land/std@0.223.0/assert/mod.ts";

Deno.test("Check version", async () => {
	const surreal = await createSurreal();
	const res = await surreal.version();

	assertEquals(res.startsWith('surrealdb-'), true, "Version to be returned");

	await surreal.close();
});