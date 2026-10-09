import type { ProgressCallback } from "../types";

/**
 * Wrap a progress callback so that one which throws cannot fail the transfer it reports on, which
 * may be an import that is half applied. What it throws is rethrown on its own, as it would be from
 * an event listener.
 */
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

/**
 * Pass a stream on as it is, reporting the bytes read from it as they go by.
 */
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

/**
 * A response whose body reports the bytes read from it as they go by. The total is the
 * `Content-Length` of the response, when it has one.
 */
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
