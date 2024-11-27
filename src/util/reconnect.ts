import { DEFAULT_RECONNECT_OPTIONS, type ReconnectOptions } from "../types";
import { rand } from "./rand";

export class ReconnectContext {
	private _attempts = 0;
	readonly options: ReconnectOptions;

	// Process options as passed by the user
	constructor(input?: Partial<ReconnectOptions> | boolean) {
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
		return this._attempts;
	}

	get enabled(): boolean {
		return this.options.enabled;
	}

	reset(): void {
		this._attempts = 0;
	}

	async iterate(): Promise<boolean> {
		if (!this.options.enabled) {
			return false;
		}

		// Bump iteration
		this._attempts++;

		// Restrict reconnect attempts and propagate ReconnectFailed error
		if (this._attempts > this.options.attempts) {
			return false;
		}

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
		return true;
	}
}
