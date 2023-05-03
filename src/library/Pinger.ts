export class Pinger {
	private pinger?: ReturnType<typeof setTimeout>;
	private interval: number;

	constructor(interval = 30000) {
		this.interval = interval;
	}

	start(callback: () => void) {
		this.pinger = setInterval(callback, this.interval);
	}

	stop() {
		clearInterval(this.pinger);
	}
}
