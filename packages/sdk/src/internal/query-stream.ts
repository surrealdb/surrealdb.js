import { Duration } from "@surrealdb/sqon";
import type { ServerError } from "../errors";
import { CallTerminatedError, UnexpectedServerResponseError } from "../errors";
import type { QueryChunk, QueryStats, QueryType } from "../types";
import { parseRpcError, type RpcErrorObject } from "./parse-error";

/**
 * The key which tags a streaming query frame, holding the frame's kind.
 *
 * Frames are only ever sent in answer to a `query_stream` request, and every
 * frame carries that request's id, so they are decoded by looking the id up in
 * the engine's own stream registry - never by inspecting the shape of an
 * arbitrary response payload, which user data could imitate.
 */
export const STREAM_FRAME_KEY = "stream";

/**
 * A single frame of a streaming query answer.
 *
 * A `query_stream` request is answered by a sequence of these instead of one
 * response: a `begin` frame, the per-statement payload and `finished` frames
 * as execution produces them, and exactly one terminal `end` frame.
 */
export type QueryStreamFrame =
    | QueryStreamBeginFrame
    | QueryStreamRowsFrame
    | QueryStreamValueFrame
    | QueryStreamFinishedFrame
    | QueryStreamEndFrame;

/**
 * The stream is open. Sent before execution begins. `statements` is an upper
 * bound on the statements which will finish, as control flow such as a `RETURN`
 * inside a `BEGIN` block can skip the tail, so results are counted by
 * `finished` frames instead.
 */
export interface QueryStreamBeginFrame {
    stream: "begin";
    statements: number;
}

/**
 * Rows produced by a statement; more may follow. The statement's value is every
 * row it emitted, in order.
 */
export interface QueryStreamRowsFrame {
    stream: "rows";
    index: number;
    values?: unknown[];
}

/**
 * A statement produced a single value which is not a list of rows, such as
 * `SELECT ONLY`, `RETURN 1 + 2`, or a block.
 */
export interface QueryStreamValueFrame {
    stream: "value";
    index: number;
    value?: unknown;
}

/**
 * A statement is final. Terminal for that statement: no further frame carries
 * it. An `error` means the statement failed and any rows already delivered for
 * it must be discarded, while `single` distinguishes a statement whose value is
 * one bare value from one whose value is a list.
 */
export interface QueryStreamFinishedFrame {
    stream: "finished";
    index: number;
    time?: string;
    type?: QueryType;
    single?: boolean;
    error?: RpcErrorObject;
}

/**
 * The stream is complete and nothing follows. An `error` means either that
 * execution stopped for a reason belonging to no single statement, retracting
 * every statement without a `finished` frame, or that something a finished
 * statement produced could not be kept after the fact.
 */
export interface QueryStreamEndFrame {
    stream: "end";
    results?: number;
    time?: string;
    error?: RpcErrorObject;
}

/**
 * The error a frame reports, as the buffered protocol would have reported it.
 *
 * A statement's failure crosses the buffered protocol inside its query result,
 * which carries no wire code, so `ServerError.code` is `0` there. A frame
 * carries the full error object, code included, and letting it through would
 * make the same failing query report a different code depending on whether the
 * answer happened to be streamed. The kind, class, message, details and cause
 * are all preserved; only the code the buffered path never had is dropped.
 */
function frameError(error: RpcErrorObject): ServerError {
    // Without a kind there is nothing but the code to resolve the error's class from, so it is
    // kept: a server old enough to omit the kind is not one that streams.
    if (!error.kind) {
        return parseRpcError(error);
    }

    // Zero is the code a query result error carries on the buffered protocol.
    return parseRpcError({ ...error, code: 0 });
}

/**
 * Returns whether the given response payload is a streaming query frame.
 *
 * Only ever applied to a payload which arrived under the request id of a
 * streaming query this engine started.
 */
export function isQueryStreamFrame(value: unknown): value is QueryStreamFrame {
    if (typeof value !== "object" || value === null) return false;
    return typeof (value as Record<string, unknown>)[STREAM_FRAME_KEY] === "string";
}

/**
 * Translates the frames of a streaming query answer into the query chunks the
 * rest of the SDK consumes.
 *
 * The frame contract is preserved as it is translated:
 *
 * - Rows are provisional until their statement's `finished` frame. A `finished` frame carrying an
 *   error becomes an error chunk, which is how the chunk consumers discard the rows already
 *   delivered for that statement.
 * - A statement contributes rows or one single value, never both, and only its `finished` frame
 *   says which it was. A single value is therefore held back until then, as the chunk consumers
 *   distinguish the two by the chunk kind.
 * - An `end` frame carrying an error retracts every statement which never finished and fails the
 *   whole query, so a stream which was stopped rather than answered is never mistaken for a
 *   complete one.
 * - The stream is only complete once its `end` frame arrives. Frames running out without one means
 *   the answer was truncated, which fails the query rather than silently returning a prefix of it -
 *   unless the consumer asked to leave, in which case there is nobody the failure belongs to.
 *
 * @param frames The frames of a single streaming query answer, in the order they arrived.
 * @returns The query chunks conveyed by those frames.
 */
export async function* queryStreamChunks<T>(
    frames: AsyncIterable<QueryStreamFrame>,
    abandonment: Abandonment = {},
): AsyncGenerator<QueryChunk<T>> {
    const batches = new Map<number, number>();
    const singles = new Map<number, unknown>();
    const unfinished = new Set<number>();
    const finished = new Set<number>();
    let ended = false;

    for await (const frame of frames) {
        // A statement's terminal frame is terminal: an outcome already delivered is never taken
        // back, so nothing which arrives for that statement afterwards is acted on.
        if (
            (frame.stream === "rows" || frame.stream === "value" || frame.stream === "finished") &&
            finished.has(frameIndex(frame.index))
        ) {
            continue;
        }

        switch (frame.stream) {
            case "begin": {
                break;
            }

            case "rows": {
                const index = frameIndex(frame.index);

                unfinished.add(index);

                yield {
                    query: index,
                    batch: nextBatch(batches, index),
                    kind: "batched",
                    // A rows frame carries a list, as the buffered path also insists.
                    result: (Array.isArray(frame.values) ? frame.values : []) as T[],
                };

                break;
            }

            case "value": {
                const index = frameIndex(frame.index);

                unfinished.add(index);
                singles.set(index, frame.value);

                break;
            }

            case "finished": {
                const index = frameIndex(frame.index);
                const stats = frameStats(frame.time);
                const single = singles.has(index) ? [singles.get(index) as T] : undefined;

                unfinished.delete(index);
                singles.delete(index);
                finished.add(index);

                if (frame.error) {
                    yield {
                        query: index,
                        batch: nextBatch(batches, index),
                        kind: "batched-final",
                        stats,
                        error: frameError(frame.error),
                    };

                    break;
                }

                yield {
                    query: index,
                    batch: nextBatch(batches, index),
                    kind: frame.single ? "single" : "batched-final",
                    stats,
                    // Carried exactly as the buffered path carries it, which leaves it unset for
                    // an ordinary statement: the consumers of a chunk are what settle on a
                    // default, and a streamed chunk must not differ from a buffered one.
                    type: frame.type,
                    // A single statement which sent no value frame produced NONE, and a statement
                    // which streamed rows has already delivered them.
                    result: frame.single ? (single ?? ([undefined] as T[])) : (single ?? []),
                };

                break;
            }

            case "end": {
                ended = true;

                if (frame.error) {
                    const error = frameError(frame.error);
                    const stats = frameStats(frame.time);
                    const retracted = [...unfinished].sort((a, b) => a - b);

                    unfinished.clear();

                    for (const index of retracted) {
                        yield {
                            query: index,
                            batch: nextBatch(batches, index),
                            kind: "batched-final",
                            stats,
                            error,
                        };
                    }

                    throw error;
                }

                return;
            }

            default: {
                // An unrecognised frame kind belongs to a newer protocol than this SDK knows. The
                // terminal frame still bounds the stream, so it is skipped rather than fatal.
                break;
            }
        }
    }

    // Frames stopping short of the terminal one means the answer was truncated, which fails the
    // query rather than returning a prefix of it. Unless the consumer is the reason they stopped:
    // it has left, and there is no one to tell.
    if (!ended && !abandonment.requested) {
        throw new CallTerminatedError();
    }
}

/**
 * Whether the consumer of a chunk stream has asked to leave it.
 */
export interface Abandonment {
    requested?: boolean;
}

/**
 * The batch number of the next chunk for a statement.
 */
function nextBatch(batches: Map<number, number>, index: number): number {
    const batch = batches.get(index) ?? 0;
    batches.set(index, batch + 1);
    return batch;
}

/**
 * The statement a frame belongs to, which crosses the wire as an integer of a
 * width the codec is free to widen.
 *
 * An index this SDK cannot represent fails the stream rather than defaulting:
 * attributing a frame to the wrong statement would silently corrupt an answer.
 */
function frameIndex(index: number): number {
    const value = Number(index);

    if (!Number.isSafeInteger(value) || value < 0) {
        throw new UnexpectedServerResponseError(index);
    }

    return value;
}

/**
 * The statistics conveyed by a frame. Only the duration is reported over the
 * streaming protocol, matching the buffered protocol.
 */
function frameStats(time: string | undefined): QueryStats | undefined {
    if (typeof time !== "string") return undefined;

    try {
        return {
            bytesReceived: -1,
            bytesScanned: -1,
            recordsReceived: -1,
            recordsScanned: -1,
            duration: Duration.parseFloat(time),
        };
    } catch {
        // A duration this SDK cannot parse is not worth failing a query over.
        return undefined;
    }
}
