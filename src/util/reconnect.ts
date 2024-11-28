import { ReconnectIterationError } from "../errors";
import { DEFAULT_RECONNECT_OPTIONS, type ReconnectOptions } from "../types";
import { rand } from "./rand";

export class ReconnectContext {
	private _attempts = 0;
	private _global: Date[] = [];
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

	get globalTimestamps(): Date[] {
		const now = new Date().getTime();
		return this._global.filter(
			(d) => now - d.getTime() <= this.options.globalRetriesTimespan,
		);
	}

	get globalAttempts(): number {
		return this.globalTimestamps.length;
	}

	get enabled(): boolean {
		return this.options.enabled;
	}

	get allowed(): boolean {
		return (
			this.options.enabled &&
			this._attempts < this.options.attempts &&
			this.globalAttempts < this.options.globalRetryAttempts
		);
	}

	reset(): void {
		this._attempts = 0;
		this._global = [...this.globalTimestamps, new Date()];
	}

	async iterate(): Promise<void> {
		// Restrict reconnect attempts and propagate ReconnectFailed error
		if (!this.allowed) {
			throw new ReconnectIterationError();
		}

		// Bump iteration
		this._attempts++;

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
