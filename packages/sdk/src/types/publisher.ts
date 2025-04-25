export type EventPayload = Record<string, unknown[]>;

export interface EventPublisher<EventMap extends EventPayload> {
	/**
	 * Subscribe to an event, invoking the provided listener when the event is emitted.
	 *
	 * @param event The event to subscribe to
	 * @param listener The listener to invoke when the event is emitted
	 * @returns A function to unsubscribe from the event
	 */
	subscribe<K extends keyof EventMap>(
		event: K,
		listener: (payload: EventMap[K]) => void,
	): () => void;
}
