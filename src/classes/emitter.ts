// deno-lint-ignore-file no-explicit-any
export type EventName = string | symbol;
export type Listener = (this: Emitter, ...args: any[]) => void;

export default interface Emitter {
	addListener(eventName: EventName, listener: Listener): this;
	off(eventName: EventName, listener: Listener): this;
}

export default class Emitter {
	#events: Map<EventName, Listener[]> = new Map();

	static {
		this.prototype.addListener = this.prototype.on;
		this.prototype.off = this.prototype.removeListener;
	}

	on(eventName: EventName, listener: Listener): this {
		const listeners = this.#events.get(eventName);
		if (listeners !== undefined) {
			listeners.push(listener);
		} else {
			this.#events.set(eventName, [listener]);
		}
		return this;
	}

	removeListener(eventName: EventName, listener: Listener): this {
		const events = this.#events.get(eventName);
		if (events !== undefined) {
			const idx = events.indexOf(listener);
			if (idx > -1) {
				if (events.length === 1) {
					this.#events.delete(eventName);
				} else {
					events.splice(idx, 1);
				}
			}
		}
		return this;
	}

	once(eventName: EventName, listener: Listener): this {
		this.on(eventName, function once(...args) {
			this.removeListener(eventName, listener);
			listener.apply(this, args);
		});
		return this;
	}

	emit(eventName: EventName, ...args: any[]): this {
		const listeners = this.#events.get(eventName);
		if (listeners !== undefined) {
			listeners.forEach((listener) => listener.apply(this, args));
		}
		return this;
	}

	removeAllListeners(eventName?: EventName): this {
		if (eventName !== undefined) {
			this.#events.delete(eventName);
		} else {
			this.#events.clear();
		}
		return this;
	}
}
