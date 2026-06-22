import { ServerError } from "../errors";
import type { RetryOptions } from "../types/surreal";
import { rand } from "./rand";

export const DEFAULT_RETRY_OPTIONS: RetryOptions = {
    enabled: false,
    attempts: 5,
    retryDelay: 100,
    retryDelayMax: 2000,
    retryDelayMultiplier: 2,
    retryDelayJitter: 0.1,
};

/**
 * Determine whether an error represents a retryable SurrealDB transaction conflict.
 *
 * Under concurrent load a transaction can fail because another transaction wrote to the
 * same data. SurrealDB surfaces this as a {@link ServerError} whose message indicates the
 * conflict can be retried. There is currently no dedicated structured error kind for this,
 * so detection is performed by inspecting the error message.
 *
 * This is the default predicate used by retry logic. You can supply your own through the
 * `retryable` option to override or extend it.
 */
export function isRetryableConflict(error: unknown): boolean {
    if (!(error instanceof ServerError)) return false;

    const message = error.message.toLowerCase();

    return message.includes("conflict") || message.includes("can be retried");
}

/**
 * Stateful tracker for a single retry loop, computing backoff with jitter between attempts.
 *
 * A fresh instance must be created per retry loop, as it tracks the number of attempts made.
 */
export class RetryContext {
    #attempts = 0;

    readonly options: RetryOptions;

    /**
     * @param input The per-call retry options, layered over the resolved `base`.
     * @param base The resolved connection-wide default to fall back to.
     */
    constructor(
        input: undefined | Partial<RetryOptions> | boolean,
        base: RetryOptions = DEFAULT_RETRY_OPTIONS,
    ) {
        if (input === undefined) {
            this.options = base;
        } else if (typeof input === "boolean") {
            this.options = { ...base, enabled: input };
        } else {
            // Providing an explicit options object opts in to retry unless `enabled` says otherwise
            this.options = { ...base, ...input, enabled: input.enabled ?? true };
        }
    }

    get attempts(): number {
        return this.#attempts;
    }

    get enabled(): boolean {
        return this.options.enabled;
    }

    /** The predicate used to determine whether an error is a retryable conflict */
    get retryable(): (error: unknown) => boolean {
        return this.options.retryable ?? isRetryableConflict;
    }

    /** Whether another retry attempt is allowed */
    get allowed(): boolean {
        if (!this.options.enabled) return false;

        if (this.options.attempts !== -1 && this.#attempts >= this.options.attempts) {
            return false;
        }

        return true;
    }

    /** Wait for the computed backoff delay before the next attempt */
    async iterate(): Promise<void> {
        // Bump iteration
        this.#attempts++;

        // Compute the next retry delay
        const multiplier = this.options.retryDelayMultiplier ** this.#attempts;
        const adjustedDelay = this.options.retryDelay * multiplier;
        const jitterModifier = rand(-this.options.retryDelayJitter, this.options.retryDelayJitter);

        const nextDelay = Math.min(
            adjustedDelay * (1 + jitterModifier),
            this.options.retryDelayMax,
        );

        // Wait for the next iteration
        await new Promise<void>((r) => setTimeout(r, nextDelay));
    }
}

/**
 * Execute `fn`, retrying it on retryable conflict errors according to the provided context.
 *
 * When retry is disabled the function is executed exactly once. On a retryable error, the
 * context backs off and retries until its attempts are exhausted, at which point the last
 * error is rethrown. Non-retryable errors are rethrown immediately.
 *
 * @param ctx A fresh retry context for this loop.
 * @param fn The work to execute. Receives the zero-based attempt number.
 * @param onRetry Optional hook invoked with the caught error before each backoff, e.g. to clean up.
 */
export async function withRetry<T>(
    ctx: RetryContext,
    fn: (attempt: number) => Promise<T>,
    onRetry?: (error: unknown) => void | Promise<void>,
): Promise<T> {
    const retryable = ctx.retryable;

    for (;;) {
        try {
            return await fn(ctx.attempts);
        } catch (error) {
            if (!ctx.enabled || !retryable(error) || !ctx.allowed) {
                throw error;
            }

            await onRetry?.(error);
            await ctx.iterate();
        }
    }
}
