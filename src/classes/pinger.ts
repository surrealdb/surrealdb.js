export default class Pinger {
	// deno-lint-ignore no-explicit-any
	#pinger?: any;

	#interval: number;

	constructor(interval = 30000) {
		this.#interval = interval;
	}

	start(func: () => void, ...args: unknown[]): void {
		this.#pinger = setInterval(func, this.#interval, ...args);
	}

	stop(): void {
		clearInterval(this.#pinger);
	}
}
