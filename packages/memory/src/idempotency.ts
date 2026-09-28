/**
 * Idempotency-key derivation for safe write retries.
 *
 * Mirrors the reference clients: the key is a SHA-256 digest of the request
 * method, path, body, and a 30-second time bucket. Identical writes replayed
 * within the same bucket collapse to a single server-side effect, which makes
 * the `/facts` and `/facts/batch` writes safe to retry.
 */

const BUCKET_SECONDS = 30;

function toHex(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let out = "";
    for (const b of bytes) out += b.toString(16).padStart(2, "0");
    return out;
}

/**
 * Computes an idempotency key for a write request.
 *
 * @param method HTTP method (e.g. `POST`).
 * @param path Request path including the context prefix.
 * @param body Serialised request body (empty string when none).
 * @param now Current epoch milliseconds (injectable for tests).
 * @returns A hex-encoded SHA-256 digest.
 */
export async function idempotencyKey(
    method: string,
    path: string,
    body: string,
    now: number = Date.now(),
): Promise<string> {
    const bucket = Math.floor(now / 1000 / BUCKET_SECONDS);
    const material = `${method}\0${path}\0${body}\0${bucket}`;
    const data = new TextEncoder().encode(material);
    const digest = await crypto.subtle.digest("SHA-256", data);
    return toHex(digest);
}
