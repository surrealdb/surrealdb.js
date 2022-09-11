export default class Pinger {

	#pinger?: NodeJS.Timer | number;

	#interval: number;

	constructor(interval = 30000) {
		this.#interval = interval;
	}

	start(func: () => void, ...args: unknown[]) {
		this.#pinger = setInterval(func, this.#interval);
	}

	stop() {
		clearInterval(this.#pinger);
	}

}
