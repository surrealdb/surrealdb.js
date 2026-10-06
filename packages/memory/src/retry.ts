const _BACKOFF_MS = [250, 500, 1000] as const;

/** Back-off delays (ms) used between retry attempts for idempotent reads. */
export function backoffSchedule(maxRetries: number): readonly number[] {
    const capped = Math.max(0, Math.min(maxRetries, _BACKOFF_MS.length));
    return _BACKOFF_MS.slice(0, capped);
}

/**
 * Whether a failed request should be retried.
 *
 * Retries apply to idempotent reads (`GET`/`HEAD`) and writes explicitly marked
 * idempotent, on `5xx` responses or connection errors (`status === null`).
 */
export function shouldRetry(
    method: string,
    status: number | null,
    attempt: number,
    maxRetries: number,
    idempotent = false,
): boolean {
    if (attempt >= maxRetries) return false;
    const m = method.toUpperCase();
    if (m !== "GET" && m !== "HEAD" && !idempotent) return false;
    if (status === null) return true;
    return status >= 500;
}
