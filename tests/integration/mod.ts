import {
	SURREAL_BIND,
	SURREAL_USER,
	SURREAL_PASS,
} from "./env.ts";

const server = new Deno.Command("surreal", {
	args: ["start"],
	env: {
		SURREAL_BIND,
		SURREAL_USER,
		SURREAL_PASS,
	}
}).spawn();

await new Promise(r => setTimeout(r, 1000));
import "./tests/auth.ts";
import "./tests/querying.ts";
