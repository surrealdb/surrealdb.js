/**
 * Server-sent-event parsing for the streaming chat endpoint.
 */

/** One incremental frame from a streaming `chat` call. */
export interface ChatChunk {
    /** Token delta for this frame (may be empty on metadata-only frames). */
    delta: string;
    /** Trace id, present once the server has assigned one. */
    traceId?: string;
    /** Session id the conversation is attached to. */
    sessionId?: string;
    /** `true` on the terminal frame. */
    done: boolean;
    /** The raw decoded frame payload. */
    raw: Record<string, unknown>;
}

function frameToChunk(payload: Record<string, unknown>, done: boolean): ChatChunk {
    const delta =
        typeof payload.delta === "string"
            ? payload.delta
            : typeof payload.token === "string"
              ? payload.token
              : "";
    const traceId =
        typeof payload.traceId === "string"
            ? payload.traceId
            : typeof payload.trace_id === "string"
              ? payload.trace_id
              : undefined;
    const sessionId =
        typeof payload.sessionId === "string"
            ? payload.sessionId
            : typeof payload.session_id === "string"
              ? payload.session_id
              : undefined;
    return { delta, traceId, sessionId, done, raw: payload };
}

/**
 * Parses an SSE response body into {@link ChatChunk}s.
 *
 * Handles multi-line `data:` payloads, comment lines, and the terminal
 * `[DONE]` sentinel.
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
                for (const line of rawFrame.split(/\r?\n/)) {
                    if (line.startsWith(":")) continue; // comment / keep-alive
                    if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
                }
                if (dataLines.length === 0) continue;
                const data = dataLines.join("\n");
                if (data === "[DONE]") {
                    yield { delta: "", done: true, raw: {} };
                    return;
                }
                let payload: Record<string, unknown>;
                try {
                    payload = JSON.parse(data) as Record<string, unknown>;
                } catch {
                    payload = { delta: data };
                }
                const isDone = payload.done === true;
                yield frameToChunk(payload, isDone);
                if (isDone) return;
            }

            if (done) break;
        }
    } finally {
        reader.releaseLock();
    }
}
