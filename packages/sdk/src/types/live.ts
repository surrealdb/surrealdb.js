import type { RecordId, Table, Uuid } from "@surrealdb/sqon";

export const LIVE_ACTIONS = ["CREATE", "UPDATE", "DELETE", "KILLED"] as const;

export type LiveResource = Table;
export type LiveAction = (typeof LIVE_ACTIONS)[number];

/**
 * A record change (`CREATE` / `UPDATE` / `DELETE`) carries the affected record
 * id and its value; a `KILLED` message signals that the live query was
 * terminated server-side (for example when its table is removed) and carries
 * no record. It is the final message a subscription emits.
 */
export type LiveMessage =
    | {
          queryId: Uuid;
          action: Exclude<LiveAction, "KILLED">;
          recordId: RecordId;
          value: Record<string, unknown>;
      }
    | {
          queryId: Uuid;
          action: "KILLED";
          recordId?: undefined;
          value?: undefined;
      };
