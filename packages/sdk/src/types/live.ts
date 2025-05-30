import { type RecordId, type Table, Uuid } from "../value";
import type { Patch } from "./patch";

export const LIVE_ACTIONS = ["CREATE", "UPDATE", "DELETE", "KILLED"] as const;

export type LiveResource = Table;
export type LiveAction = (typeof LIVE_ACTIONS)[number];
export type LiveMessage = {
	id: Uuid;
	action: LiveAction;
	record: RecordId;
	result: Record<string, unknown>;
};

export type LiveResult = Record<string, unknown> | Patch;

export type LivePayload<Result extends LiveResult = Record<string, unknown>> =
	| LivePayloadUpdate<Result>
	| LivePayloadClosed;

export type LivePayloadUpdate<
	Result extends LiveResult = Record<string, unknown>,
> = [action: Exclude<LiveAction, "KILLED">, result: Result, id: RecordId];

export type LivePayloadClosed = [
	action: "CLOSED",
	reason: "KILLED" | "DISCONNECTED",
];

export type LiveHandler<Result extends LiveResult = Record<string, unknown>> = (
	...[action, result]: LivePayload<Result>
) => unknown;

export function isLiveMessage(v: unknown): v is LiveMessage {
	if (typeof v !== "object") return false;
	if (v === null) return false;
	if (!("id" in v && "action" in v && "result" in v)) return false;

	if (!(v.id instanceof Uuid)) return false;
	if (!LIVE_ACTIONS.includes(v.action as LiveAction)) return false;
	if (typeof v.result !== "object") return false;
	if (v.result === null) return false;

	return true;
}
