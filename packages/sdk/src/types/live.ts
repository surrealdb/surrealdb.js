import type { RecordId, Table, Uuid } from "../value";

export const LIVE_ACTIONS = ["CREATE", "UPDATE", "DELETE", "KILLED"] as const;

export type LiveResource = Table;
export type LiveAction = (typeof LIVE_ACTIONS)[number];
export type LiveMessage = {
    queryId: Uuid;
    action: LiveAction;
    recordId: RecordId;
    value: Record<string, unknown>;
};

// export type LiveResult = Record<string, unknown> | Patch;

// export type LivePayload<Result extends LiveResult = Record<string, unknown>> =
//     | LivePayloadUpdate<Result>
//     | LivePayloadClosed;

// export type LivePayloadUpdate<Result extends LiveResult = Record<string, unknown>> = [
//     action: Exclude<LiveAction, "KILLED">,
//     result: Result,
//     id: RecordId,
// ];

// export type LivePayloadClosed = [action: "CLOSED", reason: "KILLED" | "DISCONNECTED"];

// export type LiveHandler<Result extends LiveResult = Record<string, unknown>> = (
//     ...[action, result]: LivePayload<Result>
// ) => unknown;
