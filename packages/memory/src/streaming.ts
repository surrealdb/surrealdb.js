/**
 * Server-sent-event parsing for the streaming chat endpoint.
 */

import { StreamError } from "./errors.js";
import type { components } from "./types/generated.js";

type CitationJson = components["schemas"]["CitationJson"];
type ExtractionResultJson = components["schemas"]["ExtractionResultJson"];

/** One incremental frame from a streaming `chat` call. */
export interface ChatChunk {
    /**
     * The SSE event name, when the server labels the frame.
     *
     * The chat stream labels every frame (`meta`, `chunk`, `done`), so this is
     * how a metadata frame is told from a token frame without inspecting the
     * payload.
     */
    event: string | undefined;
    /** Token delta for this frame (empty on metadata and terminal frames). */
    delta: string;
    /** Trace id, present once the server has assigned one. */
    traceId?: string;
    /** Session id the conversation is attached to. */
    sessionId?: string;
    /**
     * The complete reply, on the terminal frame.
     *
     * Already sanitised by the server, and identical to the concatenated
     * deltas. Prefer it over an accumulator when only the final text matters.
     */
    reply?: string;
    /**
     * What the turn wrote to memory, on the terminal frame.
     *
     * The same payload the non-streaming response carries, so a caller has no
     * reason to reconstruct it by diffing state snapshots.
     */
    memoryUpdates?: ExtractionResultJson;
    /** Sources the reply cited, on the terminal frame, one per marker. */
    citations?: CitationJson[];
    /** `true` on the terminal frame. */
    done: boolean;
    /** The raw decoded frame payload. */
    raw: Record<string, unknown>;
}

function str(value: unknown): string | undefined {
    return typeof value === "string" ? value : undefined;
}

function frameToChunk(
    payload: Record<string, unknown>,
    event: string | undefined,
    done: boolean,
): ChatChunk {
    // `text` is what the chat stream labels its token frames with; `delta` and
    // `token` are the shapes other streaming endpoints use. All three are read
    // so one parser serves every stream the API exposes.
    const delta = str(payload.delta) ?? str(payload.token) ?? str(payload.text) ?? "";
    const chunk: ChatChunk = {
        event,
        delta,
        traceId: str(payload.traceId) ?? str(payload.trace_id),
        sessionId: str(payload.sessionId) ?? str(payload.session_id),
        done,
        raw: payload,
    };

    // Terminal-frame extras. Read by shape rather than gated on the event name,
    // so a server that ends the stream with `done: true` and no label still
    // hands the caller its reply.
    const reply = str(payload.reply);
    if (reply !== undefined) chunk.reply = reply;
    if (payload.memoryUpdates !== undefined && payload.memoryUpdates !== null) {
        chunk.memoryUpdates = payload.memoryUpdates as ExtractionResultJson;
    }
    if (Array.isArray(payload.citations)) {
        chunk.citations = payload.citations as CitationJson[];
    }

    return chunk;
}

/**
 * Parses an SSE response body into {@link ChatChunk}s.
 *
 * Handles multi-line `data:` payloads, comment lines, event labels, and the
 * terminal `[DONE]` sentinel. A frame the server labels `error` is raised as a
 * {@link StreamError} rather than yielded, so a failure part-way through a
 * stream surfaces where a request failure would.
 *
 * @param response A streaming `fetch` response with a readable body.
 */
export async function* parseChatStream(response: Response): AsyncGenerator<ChatChunk> {
    const body = response.body;
    if (!body) return;
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
        for (;;) {
            const { done, value } = await reader.read();
            if (value) buffer += decoder.decode(value, { stream: true });
            if (done) buffer += decoder.decode();

            let sep: number;
            // Frames are separated by a blank line.
            // biome-ignore lint/suspicious/noAssignInExpressions: stream framing loop
            while ((sep = buffer.search(/\r?\n\r?\n/)) !== -1) {
                const rawFrame = buffer.slice(0, sep);
                buffer = buffer.slice(sep + (buffer[sep] === "\r" ? 4 : 2));
                const dataLines: string[] = [];
                let event: string | undefined;
                for (const line of rawFrame.split(/\r?\n/)) {
                    if (line.startsWith(":")) continue; // comment / keep-alive
                    if (line.startsWith("event:")) {
                        event = line.slice(6).trim();
                        continue;
                    }
                    if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
                }
                if (dataLines.length === 0) continue;
                const data = dataLines.join("\n");
                if (data === "[DONE]") {
                    yield { event, delta: "", done: true, raw: {} };
                    return;
                }
                let payload: Record<string, unknown>;
                try {
                    payload = JSON.parse(data) as Record<string, unknown>;
                } catch {
                    payload = { delta: data };
                }

                // The stream opened `200`, so a failure after the headers can
                // only arrive as a frame. Throwing keeps it from reading as a
                // stream that simply ended.
                if (event === "error" || typeof payload.error === "string") {
                    throw new StreamError({
                        status: 0,
                        title: "Chat stream failed",
                        detail: str(payload.error) ?? "The server ended the stream with an error.",
                    });
                }

                const isDone = event === "done" || payload.done === true;
                yield frameToChunk(payload, event, isDone);
                if (isDone) return;
            }

            if (done) break;
        }
    } finally {
        reader.releaseLock();
    }
}
