import { z } from "npm:zod@^3.22.4";
import { Patch } from "../types.ts";

export const Action = z.union([
	z.literal("CREATE"),
	z.literal("UPDATE"),
	z.literal("DELETE"),
]);

export type Action = z.infer<typeof Action>;

export const LiveResult = z.object({
	id: z.string().uuid(),
	action: Action,
	result: z.record(z.unknown())
});

export type LiveResult = z.infer<typeof LiveResult>;

export type LiveHandler<Result extends Record<string, unknown> | Patch = Record<string, unknown>> =
	(action: Action, result: Result) => unknown;
