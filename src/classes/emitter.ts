export type EventName = string | symbol;
export type EventMap = Record<EventName, unknown[]>;

export function once<
	EVENTMAP extends EventMap,
	EVENTNAME extends keyof EVENTMAP,
>(
	emitter: Emitter<EVENTMAP>,
	eventName: EVENTNAME,
) {
	return new Promise<EVENTMAP[EVENTNAME]>((res) => {
		emitter.once(eventName, (...args) => res(args));
	});
}

export default class Emitter<EVENTS extends EventMap = EventMap> {
	#events: {
		[K in keyof EVENTS]?: Set<(this: this, ...args: EVENTS[K]) => void>;
	} = {};

	static once = once;

	nextEvent<T extends keyof EVENTS>(eventName: T) {
		return once(this, eventName);
	}

	on<T extends keyof EVENTS>(
		eventName: T,
		listener: (this: this, ...args: EVENTS[T]) => void,
	) {
		if (!this.#events[eventName]) {
			this.#events[eventName] = new Set();
		}
		this.#events[eventName]!.add(listener);
		return this;
	}

	removeListener<T extends keyof EVENTS>(
		eventName: T,
		listener: (this: this, ...args: EVENTS[T]) => void,
	) {
		this.#events[eventName]?.delete(listener);

		if (this.#events[eventName]?.size === 0) {
			delete this.#events[eventName];
		}
		return this;
	}

	once<T extends keyof EVENTS>(
		eventName: T,
		listener: (this: this, ...args: EVENTS[T]) => void,
	) {
		return this.on(eventName, function once(...args: EVENTS[T]) {
			this.removeListener(eventName, once);
			listener.apply(this, args);
		});
	}

	emit<T extends keyof EVENTS>(eventName: T, ...args: EVENTS[T]) {
		this.#events[eventName]?.forEach((listener) =>
			listener.apply(this, args)
		);

		return this;
	}

	removeAllListeners(eventName?: keyof EVENTS) {
		if (eventName) {
			delete this.#events[eventName];
		} else {
			this.#events = {};
		}
		return this;
	}

	addListener<T extends keyof EVENTS>(
		eventName: T,
		listener: (this: this, ...args: EVENTS[T]) => void,
	) {
		return this.on(eventName, listener);
	}

	off<T extends keyof EVENTS>(
		eventName: T,
		listener: (this: this, ...args: EVENTS[T]) => void,
	) {
		return this.removeListener(eventName, listener);
	}
}
