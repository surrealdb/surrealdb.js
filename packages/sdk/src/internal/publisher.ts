import type { EventPayload, EventPublisher } from "../types/publisher";

export class Publisher<T extends EventPayload> implements EventPublisher<T> {
	#subscriptions: Partial<{
		[K in keyof T]: Set<(event: T[K]) => void>;
	}> = {};

	subscribe<K extends keyof T>(
		event: K,
		listener: (event: T[K]) => void,
	): () => void {
		this.#subscriptions[event] ??= new Set();
		this.#subscriptions[event]?.add(listener);

		return () => {
			this.#subscriptions[event]?.delete(listener);
		};
	}

	publish<K extends keyof T>(event: K, ...payload: T[K]): void {
		const subscriptions = this.#subscriptions[event];

		if (!subscriptions) {
			return;
		}

		for (const subscription of subscriptions) {
			subscription(payload);
		}
	}
}
