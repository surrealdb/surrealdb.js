export type EventName = string | symbol;
export type EventMap = Record<EventName, unknown[]>;

export function once<T extends EventMap = EventMap>(
	emitter: Emitter<T>,
	eventName: keyof T,
) {
	return new Promise((res) => {
		emitter.once(eventName, (...args) => res(args));
	});
}

export default class Emitter<Events extends EventMap = EventMap> {
	#events: {
		[K in keyof Events]?: Set<(this: this, ...args: Events[K]) => void>;
	} = {};

	static once = once;

	on<T extends keyof Events>(
		eventName: T,
		listener: (this: this, ...args: Events[T]) => void,
	) {
		if (!this.#events[eventName]) {
			this.#events[eventName] = new Set();
		}
		this.#events[eventName]!.add(listener);
		return this;
	}

	removeListener<T extends keyof Events>(
		eventName: T,
		listener: (this: this, ...args: Events[T]) => void,
	) {
		this.#events[eventName]?.delete(listener);

		if (this.#events[eventName]?.size === 0) {
			delete this.#events[eventName];
		}
		return this;
	}

	once<T extends keyof Events>(
		eventName: T,
		listener: (this: this, ...args: Events[T]) => void,
	) {
		return this.on(eventName, function once(...args: Events[T]) {
			this.removeListener(eventName, once);
			listener.apply(this, args);
		});
	}

	emit<T extends keyof Events>(eventName: T, ...args: Events[T]) {
		this.#events[eventName]?.forEach((listener) => listener.apply(this, args));

		return this;
	}

	removeAllListeners(eventName?: keyof Events) {
		if (eventName) {
			delete this.#events[eventName];
		} else {
			this.#events = {};
		}
		return this;
	}

	addListener<T extends keyof Events>(
		eventName: T,
		listener: (this: this, ...args: Events[T]) => void,
	) {
		return this.on(eventName, listener);
	}

	off<T extends keyof Events>(
		eventName: T,
		listener: (this: this, ...args: Events[T]) => void,
	) {
		return this.removeListener(eventName, listener);
	}
}
