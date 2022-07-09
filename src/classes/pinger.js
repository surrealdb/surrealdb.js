export default class Pinger {

	#pinger = undefined;

	#interval = undefined;

	constructor(interval = 30000) {
		this.#interval = interval;
	}

	start(func, ...args) {
		this.#pinger = setInterval(func, this.#interval);
	}

	stop() {
		clearInterval(this.#pinger);
	}

}
