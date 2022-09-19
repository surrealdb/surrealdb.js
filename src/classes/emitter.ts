// deno-lint-ignore-file no-explicit-any
export type Listener = (this: Emitter, ...args: any[]) => void;

export default class Emitter {
	#events: Record<string, Listener[]> = {};

	on(e: string, func: Listener) {
		if (typeof this.#events[e] !== "object") {
			this.#events[e] = [];
		}
		this.#events[e].push(func);
	}

	off(e: string, func: Listener) {
		if (typeof this.#events[e] === "object") {
			const idx = this.#events[e].indexOf(func);
			if (idx > -1) {
				this.#events[e].splice(idx, 1);
			}
		}
	}

	once(e: string, func: Listener) {
		this.on(e, function f(...args) {
			this.off(e, f);
			func.apply(this, args);
		});
	}

	emit(e: string, ...args: any[]) {
		if (typeof this.#events[e] === "object") {
			this.#events[e].forEach((func) => {
				func.apply(this, args);
			});
		}
	}

	removeAllListeners(e?: string) {
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
