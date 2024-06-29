export type Listener<Args extends unknown[] = unknown[]> = (
	...args: Args
) => unknown;
export type UnknownEvents = Record<string, unknown[]>;

export class Emitter<Events extends UnknownEvents = UnknownEvents> {
	private collectable: Partial<{
		[K in keyof Events]: Events[K][];
	}> = {};

	private listeners: Partial<{
		[K in keyof Events]: Listener<Events[K]>[];
	}> = {};

	private readonly interceptors: Partial<{
		[K in keyof Events]: (...args: Events[K]) => Promise<Events[K]>;
	}>;

	constructor({
		interceptors,
	}: {
		interceptors?: Partial<{
			[K in keyof Events]: (...args: Events[K]) => Promise<Events[K]>;
		}>;
	} = {}) {
		this.interceptors = interceptors ?? {};
	}

	subscribe<Event extends keyof Events>(
		event: Event,
		listener: Listener<Events[Event]>,
		historic = false,
	) {
		if (!this.listeners[event]) {
			this.listeners[event] = [];
		}

		if (!this.isSubscribed(event, listener)) {
			this.listeners[event]?.push(listener);

			if (historic && this.collectable[event]) {
				const buffer = this.collectable[event];
				this.collectable[event] = [];
				for (const args of buffer) {
					listener(...args);
				}
			}
		}
	}

	subscribeOnce<Event extends keyof Events>(event: Event, historic = false) {
		return new Promise<Events[Event]>((resolve) => {
			let resolved = false;
			const listener = (...args: Events[Event]) => {
				if (!resolved) {
					resolved = true;
					this.unSubscribe(event, listener);
					resolve(args);
				}
			};

			this.subscribe(event, listener, historic);
		});
	}

	unSubscribe<Event extends keyof Events>(
		event: Event,
		listener: Listener<Events[Event]>,
	) {
		if (this.listeners[event]) {
			const index = this.listeners[event]?.findIndex((v) => v === listener);
			if (index) {
				this.listeners[event]?.splice(index, 1);
			}
		}
	}

	isSubscribed<Event extends keyof Events>(
		event: Event,
		listener: Listener<Events[Event]>,
	) {
		return !!this.listeners[event]?.includes(listener);
	}

	async emit<Event extends keyof Events>(
		event: Event,
		args: Events[Event],
		collectable = false,
	) {
		const interceptor = this.interceptors[event];
		const computedArgs = interceptor ? await interceptor(...args) : args;

		if (this.listeners[event]?.length === 0 && collectable) {
			if (!this.collectable[event]) {
				this.collectable[event] = [];
			}

			this.collectable[event]?.push(args);
		}

		for (const listener of this.listeners[event] ?? []) {
			listener(...computedArgs);
		}
	}

	reset({
		collectable,
		listeners,
	}: {
		collectable?: boolean | keyof Events | (keyof Events)[];
		listeners?: boolean | keyof Events | (keyof Events)[];
	}) {
		if (Array.isArray(collectable)) {
			for (const k of collectable) {
				delete this.collectable[k];
			}
		} else if (typeof collectable === "string") {
			delete this.collectable[collectable];
		} else if (collectable !== false) {
			this.collectable = {};
		}

		if (Array.isArray(listeners)) {
			for (const k of listeners) {
				delete this.listeners[k];
			}
		} else if (typeof listeners === "string") {
			delete this.listeners[listeners];
		} else if (listeners !== false) {
			this.listeners = {};
		}
	}

	scanListeners(filter?: (k: keyof Events) => boolean) {
		let listeners = Object.keys(this.listeners) as (keyof Events)[];
		if (filter) listeners = listeners.filter(filter);
		return listeners;
	}
}
