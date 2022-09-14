export default class Pinger {

	#pinger?: NodeJS.Timer | number;

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
