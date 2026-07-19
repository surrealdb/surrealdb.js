import type { LiveMessage } from "../types";

/**
 * Routes live-query notifications to per-id subscribers, buffering any that
 * arrive before a subscriber has attached.
 *
 * A LIVE query is registered on the server before its round-trip resolves on
 * the client, so the server can start emitting notifications while the client
 * is still one tick away from subscribing to the per-id stream. Without a
 * buffer those notifications are delivered to an id with no listener and are
 * silently lost. Holding them until the first subscriber attaches closes that
 * window without changing delivery order.
 */
export class LiveDispatcher {
    #subscribers = new Map<string, Set<(message: LiveMessage) => void>>();
    #pending = new Map<string, LiveMessage[]>();
    #limit: number;

    /**
     * @param limit Maximum notifications buffered per id before the oldest are
     * dropped. Guards against a live query that is registered and receiving but
     * never subscribed to (e.g. a caller that abandons the round-trip).
     */
    constructor(limit = 1024) {
        this.#limit = limit;
    }

    /**
     * Deliver a notification to the id's subscribers, or buffer it until one
     * attaches.
     */
    dispatch(id: string, message: LiveMessage): void {
        const subscribers = this.#subscribers.get(id);

        if (subscribers && subscribers.size > 0) {
            for (const notify of subscribers) {
                notify(message);
            }

            return;
        }

        const buffer = this.#pending.get(id);

        if (buffer) {
            buffer.push(message);

            if (buffer.length > this.#limit) {
                buffer.shift();
            }
        } else {
            this.#pending.set(id, [message]);
        }
    }

    /**
     * Subscribe to notifications for an id, replaying any that were buffered
     * before this subscriber attached. Returns an unsubscribe function.
     */
    subscribe(id: string, notify: (message: LiveMessage) => void): () => void {
        let subscribers = this.#subscribers.get(id);

        if (!subscribers) {
            subscribers = new Set();
            this.#subscribers.set(id, subscribers);
        }

        subscribers.add(notify);

        // Replay notifications received before this subscriber attached. This is
        // synchronous, so no live notification can interleave and reorder them.
        const buffered = this.#pending.get(id);

        if (buffered) {
            this.#pending.delete(id);

            for (const message of buffered) {
                notify(message);
            }
        }

        return () => {
            const current = this.#subscribers.get(id);

            if (current?.delete(notify) && current.size === 0) {
                this.#subscribers.delete(id);
            }
        };
    }

    /**
     * Drop all buffered notifications. Called when the connection drops, since
     * any pending ids are for live queries that will be re-registered under a
     * fresh id once the connection is re-established.
     */
    clear(): void {
        this.#pending.clear();
    }
}
