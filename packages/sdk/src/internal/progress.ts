import type { ProgressCallback } from "../types";

/** Keep a throwing callback from failing a half-applied import; rethrow it as a listener would */
export function reportProgress(callback: ProgressCallback): ProgressCallback {
    return (progress) => {
        try {
            callback(progress);
        } catch (error) {
            queueMicrotask(() => {
                throw error;
            });
        }
    };
}

/** Pass a stream on as it is, reporting the bytes read from it as they go by */
export function countBytes(
    source: ReadableStream<Uint8Array>,
    onProgress: ProgressCallback,
    total?: number,
): ReadableStream<Uint8Array> {
    let loaded = 0;

    return source.pipeThrough(
        new TransformStream<Uint8Array, Uint8Array>({
            transform(chunk, controller) {
                loaded += chunk.byteLength;
                controller.enqueue(chunk);
                onProgress({ loaded, total });
            },
        }),
    );
}

/** A response whose body reports the bytes read from it, against its `Content-Length` if any */
export function countResponse(response: Response, onProgress: ProgressCallback): Response {
    if (!response.body) return response;

    const length = response.headers.get("Content-Length");
    const total = length === null ? undefined : Number(length);

    return new Response(
        countBytes(response.body, onProgress, Number.isFinite(total) ? total : undefined),
        {
            status: response.status,
            statusText: response.statusText,
            headers: response.headers,
        },
    );
}

/** The UTF-8 length of a string, without encoding a copy of it */
export function utf8Length(text: string): number {
    let length = 0;

    for (let i = 0; i < text.length; i++) {
        const code = text.charCodeAt(i);

        if (code < 0x80) {
            length += 1;
        } else if (code < 0x800) {
            length += 2;
        } else if (
            code >= 0xd800 &&
            code < 0xdc00 &&
            (text.charCodeAt(i + 1) & 0xfc00) === 0xdc00
        ) {
            length += 4;
            i++;
        } else {
            length += 3;
        }
    }

    return length;
}
