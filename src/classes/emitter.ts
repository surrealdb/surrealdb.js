// deno-lint-ignore-file no-explicit-any
export type Listener<
	TThis = any,
	TArgs extends any[] = any[],
> = (this: TThis, ...args: TArgs) => void;

/**
 * A record mapping event's names to its listener arguments.
 */
export type EmitterEvents<
	TEventName extends string = string,
	TEventArguments extends any[] = any[],
> = {
	[eventName in TEventName]: TEventArguments;
};

export default class Emitter<
	TEmitterEvent extends EmitterEvents = EmitterEvents,
> {
	#events: {
		[TKey in keyof TEmitterEvent]?: Listener<this, TEmitterEvent[TKey]>[];
	} = {};

	on<TKey extends keyof TEmitterEvent>(
		e: TKey,
		func: Listener<this, TEmitterEvent[TKey]>,
	) {
		if (!Array.isArray(this.#events[e])) {
			this.#events[e] = [];
		}
		this.#events[e]!.push(func);
	}

	off<TKey extends keyof TEmitterEvent>(
		e: TKey,
		func: Listener<this, TEmitterEvent[TKey]>,
	) {
		if (Array.isArray(this.#events[e])) {
			const idx = this.#events[e]!.indexOf(func);
			if (idx && idx > -1) {
				this.#events[e]!.splice(idx, 1);
			}
		}
	}

	once<TKey extends keyof TEmitterEvent>(
		e: TKey,
		func: Listener<this, TEmitterEvent[TKey]>,
	) {
		this.on(e, function f(...args: TEmitterEvent[TKey]) {
			this.off(e, f);
			func.apply(this, args);
		});
	}

	emit<TKey extends keyof TEmitterEvent>(
		e: TKey,
		...args: TEmitterEvent[TKey]
	) {
		if (Array.isArray(this.#events[e])) {
			this.#events[e]!.forEach(
				(func: (...args: TEmitterEvent[TKey]) => void) => {
					func.apply(this, args);
				},
			);
		}
	}

	removeAllListeners<TKey extends keyof TEmitterEvent>(e?: TKey) {
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
