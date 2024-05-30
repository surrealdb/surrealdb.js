import { assertEquals } from "@std/assert";
import { isVersionSupported } from "../../src/library/versionCheck.ts";

Deno.test("isVersionSupported", () => {
	assertEquals(
		isVersionSupported("1.0.0"),
		false,
		"1.0.0 should be unsupported",
	);
	assertEquals(
		isVersionSupported("1.4.1"),
		false,
		"1.4.1 should be unsupported",
	);
	assertEquals(
		isVersionSupported("1.4.2"),
		true,
		"1.4.2 should be supported",
	);
	assertEquals(
		isVersionSupported("1.99.99"),
		true,
		"1.99.99 should be supported",
	);
	assertEquals(
		isVersionSupported("2.0.0"),
		false,
		"2.0.0 should be unsupported",
	);
});
