import { ReconnectIterationError } from "../errors";
import type { ReconnectOptions } from "../types/surreal";
import { rand } from "./rand";

export const DEFAULT_RECONNECT_OPTIONS: ReconnectOptions = {
	enabled: true,
	attempts: 5,
	retryDelay: 1000,
	retryDelayMax: 60000,
	retryDelayMultiplier: 2,
	retryDelayJitter: 0.1,
};

export class ReconnectContext {
	#attempts = 0;

	readonly options: ReconnectOptions;

	// Process options as passed by the user
	constructor(input: undefined | Partial<ReconnectOptions> | boolean) {
		if (!input) {
			this.options = {
				...DEFAULT_RECONNECT_OPTIONS,
				enabled: false,
			};
		} else if (input === true) {
			this.options = DEFAULT_RECONNECT_OPTIONS;
		} else {
			this.options = {
				...DEFAULT_RECONNECT_OPTIONS,
				...input,
			};
		}
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
		if (
			this.options.attempts !== -1 &&
			this.#attempts >= this.options.attempts
		) {
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
		const jitterModifier = rand(
			-this.options.retryDelayJitter,
			this.options.retryDelayJitter,
		);

		const nextDelay = Math.min(
			adjustedDelay * (1 + jitterModifier),
			this.options.retryDelayMax,
		);

		// Wait for the next iteration
		await new Promise<void>((r) => setTimeout(r, nextDelay));
	}
}
