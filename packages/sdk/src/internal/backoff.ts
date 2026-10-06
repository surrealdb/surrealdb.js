import type { ReconnectOptions } from "../types/surreal";
import { rand } from "./rand";

/**
 * The delay in milliseconds before the given attempt, the first of which is 1, computed the
 * way the delay between reconnect attempts is: exponential, with jitter, and never more than
 * the maximum.
 */
export function backoffDelay(
    options: Pick<
        ReconnectOptions,
        "retryDelay" | "retryDelayMax" | "retryDelayMultiplier" | "retryDelayJitter"
    >,
    attempt: number,
): number {
    const multiplier = options.retryDelayMultiplier ** attempt;
    const jitterModifier = rand(-options.retryDelayJitter, options.retryDelayJitter);

    return Math.min(options.retryDelay * multiplier * (1 + jitterModifier), options.retryDelayMax);
}
