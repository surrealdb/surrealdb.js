export default class Pinger {

	#pinger?: ReturnType<typeof setTimeout>;

	#interval: number;

	constructor(interval = 30000) {
		this.#interval = interval;
	}

	start(func: () => void, ...args: unknown[]): void {
		this.#pinger = setInterval(func, this.#interval);
	}

	stop(): void {
		clearInterval(this.#pinger);
	}

}
