import type { SpectronFileInput } from "./types/domain.js";

/**
 * Normalises a file-like input to a `Blob` for multipart uploads.
 * `ReadableStream` inputs are buffered in full (suitable for typical document sizes).
 */
export async function spectronFileInputToBlob(
    input: SpectronFileInput,
    mimeType?: string,
): Promise<Blob> {
    if (typeof File !== "undefined" && input instanceof File) {
        return input;
    }
    if (input instanceof Blob) {
        return input;
    }
    if (input instanceof ArrayBuffer) {
        return new Blob([input], { type: mimeType });
    }
    if (ArrayBuffer.isView(input)) {
        return new Blob([input as ArrayBufferView], { type: mimeType });
    }
    const stream = input as ReadableStream<Uint8Array>;
    const reader = stream.getReader();
    const chunks: Uint8Array[] = [];
    try {
        for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            if (value) chunks.push(value);
        }
    } finally {
        reader.releaseLock();
    }
    const total = chunks.reduce((a, c) => a + c.byteLength, 0);
    const out = new Uint8Array(total);
    let offset = 0;
    for (const c of chunks) {
        out.set(c, offset);
        offset += c.byteLength;
    }
    return new Blob([out], { type: mimeType });
}
