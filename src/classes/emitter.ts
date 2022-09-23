// deno-lint-ignore-file no-explicit-any
export type EventName = string | symbol;
export type Listener = (this: Emitter, ...args: any[]) => void;

export type EventMap = Record<EventName, any>;

export default interface Emitter<Events extends EventMap = EventMap> {
	addListener<T extends keyof Events>(
		eventName: T,
		listener: (this: this, ...args: Events[T]) => void,
	): this;
	addListener(eventName: EventName, listener: Listener): this;
	off<T extends keyof Events>(
		eventName: T,
		listener: (this: this, ...args: Events[T]) => void,
	): this;
	off(eventName: EventName, listener: Listener): this;
}

type EventsOf<T> = T extends { _emitter: Emitter<infer U> } ? U
	: T extends Emitter<infer U> ? U
	: never;

export function once<T extends Emitter, K extends keyof EventsOf<T>>(
	emitter: T,
	eventName: K,
): Promise<EventsOf<T>[K]>;
export function once(emitter: Emitter, eventName: EventName): Promise<any[]> {
	return new Promise((res) => {
		emitter.once(eventName, (...args) => res(args));
	});
}

export default class Emitter<Events extends EventMap = EventMap> {
	#events: {
		[K in keyof Events]?: ((this: this, ...args: Events[K]) => void)[];
	} = {};

	static once = once;

	static {
		this.prototype.addListener = this.prototype.on;
		this.prototype.off = this.prototype.removeListener;
	}

	on<T extends keyof Events>(
		eventName: T,
		listener: (this: this, ...args: Events[T]) => void,
	): this {
		const listeners = this.#events[eventName];
		if (listeners !== undefined) {
			listeners.push(listener);
		} else {
			this.#events[eventName] = [listener];
		}
		return this;
	}

	removeListener<T extends keyof Events>(
		eventName: T,
		listener: (this: this, ...args: Events[T]) => void,
	): this {
		const events = this.#events[eventName];
		if (events !== undefined) {
			const idx = events.indexOf(listener);
			if (idx > -1) {
				if (events.length === 1) {
					delete this.#events[eventName];
				} else {
					events.splice(idx, 1);
				}
			}
		}
		return this;
	}

	once<T extends keyof Events>(
		eventName: T,
		listener: (this: this, ...args: Events[T]) => void,
	): this {
		this.on(eventName, function once(...args: Events[T]) {
			this.removeListener(eventName, once);
			listener.apply(this, args);
		});
		return this;
	}

	emit<T extends keyof Events>(eventName: T, ...args: Events[T]): this {
		const listeners = this.#events[eventName];
		if (listeners !== undefined) {
			listeners.forEach((listener) => listener.apply(this, args));
		}
		return this;
	}

	removeAllListeners(eventName?: keyof Events): this;
	removeAllListeners(eventName?: EventName): this {
		if (eventName !== undefined) {
			delete this.#events[eventName];
		} else {
			this.#events = {};
		}
		return this;
	}
}
