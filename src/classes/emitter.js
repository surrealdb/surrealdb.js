export default class Emitter {

	#events = {};

	on(e, func) {
		if (typeof this.#events[e] !== "object") {
			this.#events[e] = [];
		}
		this.#events[e].push(func);
	}

	off(e, func) {
		if (typeof this.#events[e] === "object") {
			const idx = this.#events[e].indexOf(func);
			if (idx > -1) {
				this.#events[e].splice(idx, 1);
			}
		}
	}

	once(e, func) {
		this.on(e, function f(...args) {
			this.off(e, f);
			func.apply(this, args);
		});
	}

	emit(e, ...args) {
		if (typeof this.#events[e] === "object") {
			this.#events[e].forEach(func => {
				func.apply(this, args);
			});
		}
	}

	removeAllListeners(e) {
		if (e) {
			if (typeof this.#events[e] === "object") {
				this.#events[e] = [];
			}
		} else {
			for (const e in this.#events) {
				this.#events[e] = [];
			}
		}
	}

}
