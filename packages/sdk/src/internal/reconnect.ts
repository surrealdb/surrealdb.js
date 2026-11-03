import { ReconnectIterationError } from "../errors";
import type { ReconnectOptions } from "../types/surreal";
import { rand } from "./rand";

/**
 * A dropped connection is retried for as long as it stays dropped, with the delay growing to a
 * cap of twenty seconds. Giving up after a fixed number of attempts would end the connection
 * during an outage longer than the attempts last, which is the case a reconnect exists for; the
 * clients of other databases retry without a limit for the same reason. The jitter keeps many
 * clients from returning in step once a server comes back.
 */
export const DEFAULT_RECONNECT_OPTIONS: ReconnectOptions = {
    enabled: true,
    attempts: -1,
    retryDelay: 1000,
    retryDelayMax: 20000,
    retryDelayMultiplier: 2,
    retryDelayJitter: 0.1,
};

export class ReconnectContext {
    #attempts = 0;

    readonly options: ReconnectOptions;

    // Process options as passed by the user
    constructor(input: undefined | Partial<ReconnectOptions> | boolean) {
        const override = typeof input === "boolean" ? { enabled: input } : input;

        this.options = {
            ...DEFAULT_RECONNECT_OPTIONS,
            ...override,
        };
    }

    get attempts(): number {
        return this.#attempts;
    }

    get enabled(): boolean {
        return this.options.enabled;
    }

    get allowed(): boolean {
        // Check if reconnecting is enabled
        if (!this.options.enabled) return false;

        // Check if the maximum number of attempts has been reached
        if (this.options.attempts !== -1 && this.#attempts >= this.options.attempts) {
            return false;
        }

        return true;
    }

    reset(): void {
        this.#attempts = 0;
    }

    propagate(error: Error): void {
        this.options.catch?.(error);
    }

    async iterate(): Promise<void> {
        // Restrict reconnect attempts and propagate ReconnectFailed error
        if (!this.allowed) {
            throw new ReconnectIterationError();
        }

        // Bump iteration
        this.#attempts++;

        // Compute the next reconnect delay
        const multiplier = this.options.retryDelayMultiplier ** this.attempts;
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
