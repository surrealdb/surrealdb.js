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
	#events = new Map<EventName, Listener[]>();

	static once = once;

	static {
		this.prototype.addListener = this.prototype.on;
		this.prototype.off = this.prototype.removeListener;
	}

	// @ts-expect-error this is correct since we're overwriting with specific args.
	on<T extends keyof Events>(
		eventName: T,
		listener: (this: this, ...args: Events[T]) => void,
	): this;
	on(eventName: EventName, listener: Listener): this {
		const listeners = this.#events.get(eventName);
		if (listeners !== undefined) {
			listeners.push(listener);
		} else {
			this.#events.set(eventName, [listener]);
		}
		return this;
	}

	// @ts-expect-error see above.
	removeListener<T extends keyof Events>(
		eventName: T,
		listener: (this: this, ...args: Events[T]) => void,
	): this;
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

	// @ts-expect-error see above.
	once<T extends keyof Events>(
		eventName: T,
		listener: (this: this, ...args: Events[T]) => void,
	): this;
	once(eventName: EventName, listener: Listener): this {
		this.on(eventName, function once(...args: any[]) {
			this.removeListener(eventName, once);
			listener.apply(this, args);
		});
		return this;
	}

	emit<T extends keyof Events>(eventName: T, ...args: Events[T]): this;
	emit(eventName: EventName, ...args: any[]): this {
		const listeners = this.#events.get(eventName);
		if (listeners !== undefined) {
			listeners.forEach((listener) => listener.apply(this, args));
		}
		return this;
	}

	removeAllListeners(eventName?: keyof Events): this;
	removeAllListeners(eventName?: EventName): this {
		if (eventName !== undefined) {
			this.#events.delete(eventName);
		} else {
			this.#events.clear();
		}
		return this;
	}
}
