import type { ConnectionController } from "../../../../sdk/src/controller";
import { QueryError, type ServerError, ThrownError } from "../../../../sdk/src/errors";
import { DEFAULT_RETRY_OPTIONS } from "../../../../sdk/src/internal/retry";
import type { QueryChunk, QueryResponse, RetryOptions } from "../../../../sdk/src/types";
import type { BoundQuery } from "../../../../sdk/src/utils/bound-query";

// =========================================================== //
//  The errors a real server reports (SurrealDB 3.2.3)          //
// =========================================================== //

export const notExecuted = () =>
    new QueryError({
        kind: "Query",
        message: "The query was not executed due to a failed transaction",
        details: { kind: "NotExecuted" },
    });

export const cancelled = () =>
    new QueryError({
        kind: "Query",
        message: "The query was not executed due to a cancelled transaction",
        details: { kind: "Cancelled" },
    });

export const abortedCommit = () =>
    new QueryError({
        kind: "Query",
        message: "Cannot COMMIT: the transaction was aborted due to a prior error",
        details: { kind: "NotExecuted" },
    });

export const thrown = (message = "boom") =>
    new ThrownError({ kind: "Thrown", message: `An error occurred: ${message}` });

export const conflict = () =>
    new QueryError({
        kind: "Query",
        message:
            "Cannot COMMIT: Transaction conflict: Write conflict. This transaction can be retried",
        details: { kind: "TransactionConflict" },
    });

// =========================================================== //
//  Scripted responses                                          //
// =========================================================== //

export type Slot = { ok: unknown } | { error: ServerError };

export const ok = (value?: unknown): Slot => ({ ok: value });
export const fail = (error: ServerError): Slot => ({ error });

export function toResponses(slots: Slot[]): QueryResponse[] {
    return slots.map((slot) =>
        "error" in slot
            ? { success: false, error: slot.error }
            : { success: true, result: slot.ok, type: "other" },
    );
}

export function toChunks(slots: Slot[]): QueryChunk<unknown>[] {
    return slots.map((slot, index) => ({
        query: index,
        batch: 0,
        kind: "single",
        ...("error" in slot
            ? { error: slot.error }
            : { result: [slot.ok], type: "other" as const }),
    }));
}

/**
 * A connection which answers the n-th request with the n-th script (the last one is repeated),
 * one chunk for each slot of the script, the way the server answers a query. For a
 * `BEGIN ... COMMIT` query that is a slot for the BEGIN, one for each statement, and a slot
 * for the COMMIT.
 *
 * It records what it was asked in `sent`, and how many chunks have been read from it in
 * `pulled`, which tells whether a reader stopped early.
 */
export function connection(
    scripts: (Slot[] | Error)[],
    options: { version?: string | null; retry?: Partial<RetryOptions> } = {},
) {
    const sent: { query: BoundQuery; session: unknown; transaction: unknown }[] = [];

    const fake = {
        sent,
        pulled: 0,
        ready: async () => {},
        retry: { ...DEFAULT_RETRY_OPTIONS, retryDelay: 0, retryDelayMax: 0, ...options.retry },
        serverVersion:
            options.version === null ? undefined : (options.version ?? "surrealdb-3.2.3"),
        query: (query: BoundQuery, session: unknown, transaction: unknown) => {
            const script = scripts[Math.min(sent.length, scripts.length - 1)];
            sent.push({ query, session, transaction });

            return (async function* () {
                if (script instanceof Error) throw script;

                for (const chunk of toChunks(script)) {
                    fake.pulled++;
                    yield chunk;
                }
            })();
        },
    };

    return fake as typeof fake & ConnectionController;
}
