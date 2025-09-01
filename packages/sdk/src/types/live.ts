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
