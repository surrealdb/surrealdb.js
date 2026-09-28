import { parseQueryError, parseRpcError, type RpcErrorObject } from "../internal/parse-error";
import { statsFromTime } from "../internal/query-stats";
import type { QueryChunk, QueryType } from "../types/surreal";

/**
 * One frame of a streaming query answer.
 *
 * A `query_stream` request is answered by a sequence of these instead of a
 * single response: one `begin`, each statement's payload and `finished` frames
 * as execution produces them, and exactly one terminal `end`.
 *
 * The wire shape is identical across every transport that streams, so this
 * describes what an embedded engine and a WebSocket connection both send.
 */
export type QueryStreamFrame =
    | { stream: "begin"; statements: number }
    | { stream: "rows"; index: number; values: unknown[] }
    | { stream: "value"; index: number; value: unknown }
    | {
          stream: "finished";
          index: number;
          time: string;
          type?: QueryType;
          single?: boolean;
          error?: RpcErrorObject;
      }
    | { stream: "end"; results: number; time: string; error?: RpcErrorObject };

/**
 * Turn a stream of frames into the chunks the query API consumes.
 *
 * Rows are forwarded the moment their frame arrives rather than held until the
 * statement that produced them finishes, so time-to-first-row is the cost of one
 * batch rather than of the whole result. A statement is closed by a final
 * `batched-final` chunk carrying no further rows, which is what lets every
 * preceding batch go out without knowing whether another will follow.
 *
 * # Rows are provisional until their statement finishes
 *
 * A statement may still fail after emitting rows, and inside a `BEGIN … COMMIT`
 * block its transaction may still roll back. A `finished` frame carrying an
 * error retracts every row already delivered for that statement, and it is
 * reported here as an errored chunk for that statement — a consumer that acts on
 * rows as they arrive has to be able to take them back.
 *
 * A failure belonging to no single statement arrives on the terminal frame and
 * is thrown, because it invalidates every statement that never finished rather
 * than any one of them. That includes a failure from before execution began — a
 * parse error, a denied capability — which reaches a consumer as a stream whose
 * only frame is the terminal one.
 */
export async function* framesToChunks<T>(
    frames: AsyncIterable<QueryStreamFrame>,
): AsyncIterable<QueryChunk<T>> {
    /** The batch counter and held single value for each open statement. */
    const open = new Map<number, { batch: number; value?: unknown }>();

    const state = (index: number) => {
        let entry = open.get(index);
        if (!entry) {
            entry = { batch: 0 };
            open.set(index, entry);
        }
        return entry;
    };

    for await (const frame of frames) {
        switch (frame.stream) {
            case "begin":
                break;

            case "rows": {
                const entry = state(frame.index);
                yield {
                    query: frame.index,
                    batch: entry.batch++,
                    kind: "batched",
                    result: frame.values as T[],
                };
                break;
            }

            // A single value is not a list, so it is held until its statement
            // finishes: only then is it known whether it is the statement's
            // whole value or an error retracted it.
            case "value":
                state(frame.index).value = frame.value;
                break;

            case "finished": {
                // Read without inserting: a statement that emitted neither rows
                // nor a value has no entry, and closing it does not need one.
                const entry = open.get(frame.index);
                open.delete(frame.index);
                const batch = entry?.batch ?? 0;
                const stats = statsFromTime(frame.time);

                if (frame.error) {
                    yield {
                        query: frame.index,
                        batch,
                        kind: "batched-final",
                        stats,
                        // A statement's failure is a query result error, not a
                        // method error: it carries no JSON-RPC code, and its
                        // details are the doubly-wrapped shape the buffered
                        // path unwraps. Reported the same way here, so which
                        // path answered a query is not something a caller can
                        // tell from the error it catches.
                        error: parseQueryError({
                            status: "ERR",
                            time: frame.time,
                            result: frame.error.message,
                            kind: frame.error.kind,
                            details: frame.error.details,
                            cause: frame.error.cause,
                        }),
                    };
                    break;
                }

                yield frame.single
                    ? {
                          query: frame.index,
                          batch,
                          kind: "single",
                          stats,
                          type: frame.type,
                          result: [entry?.value] as T[],
                      }
                    : {
                          // Closes the statement without carrying rows: every
                          // row it produced has already been delivered.
                          query: frame.index,
                          batch,
                          kind: "batched-final",
                          stats,
                          type: frame.type,
                          result: [],
                      };
                break;
            }

            case "end":
                if (frame.error) {
                    throw parseRpcError(frame.error);
                }
                break;
        }
    }
}
