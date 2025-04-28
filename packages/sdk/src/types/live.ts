import { Uuid } from "../value";
import type { Patch } from "./patch";

export const LIVE_ACTIONS = ["CREATE", "UPDATE", "DELETE"] as const;

export type LiveAction = (typeof LIVE_ACTIONS)[number];
export type LiveResult = {
	id: Uuid;
	action: LiveAction;
	result: Record<string, unknown>;
};

export type LiveHandlerArguments<
	Result extends Record<string, unknown> | Patch = Record<string, unknown>,
> =
	| [action: LiveAction, result: Result]
	| [action: "CLOSE", result: "killed" | "disconnected"];

export type LiveHandler<
	Result extends Record<string, unknown> | Patch = Record<string, unknown>,
> = (...[action, result]: LiveHandlerArguments<Result>) => unknown;

export function isLiveResult(v: unknown): v is LiveResult {
	if (typeof v !== "object") return false;
	if (v === null) return false;
	if (!("id" in v && "action" in v && "result" in v)) return false;

	if (!(v.id instanceof Uuid)) return false;
	if (!LIVE_ACTIONS.includes(v.action as LiveAction)) return false;
	if (typeof v.result !== "object") return false;
	if (v.result === null) return false;

	return true;
}
