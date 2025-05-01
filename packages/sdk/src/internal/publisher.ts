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

/**
 * Subscribe to the first event that is emitted and resolve the promise with the event payload
 *
 * @param publisher The event publisher
 * @param events The events to subscribe to
 * @returns A promise that resolves with the event payload for the first triggered event
 */
export function subscribeFirst<T extends EventPayload, K extends keyof T>(
	publisher: EventPublisher<T>,
	...events: K[]
): Promise<T[K]> {
	const subscriptions: (() => void)[] = [];

	return new Promise((resolve) => {
		for (const event of events) {
			const unsubscribe = publisher.subscribe(event, (payload: T[K]) => {
				for (const subscription of subscriptions) {
					subscription();
				}

				resolve(payload);
			});

			subscriptions.push(unsubscribe);
		}
	});
}
