import { LIVE_QUERY_BUFFER_LIMIT } from "../internal/live-query-buffer";
import type { LiveMessage } from "../types";

interface PendingNotifications {
    messages: LiveMessage[];
    overflow: boolean;
    serverKilled: boolean;
}

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
    #pending = new Map<string, PendingNotifications>();
    #limit: number;

    /**
     * @param limit Maximum notifications buffered per id before the oldest are
     * dropped. Guards against a live query that is registered and receiving but
     * never subscribed to (e.g. a caller that abandons the round-trip).
     */
    constructor(limit = LIVE_QUERY_BUFFER_LIMIT) {
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

        let pending = this.#pending.get(id);

        if (!pending) {
            pending = { messages: [], overflow: false, serverKilled: false };
            this.#pending.set(id, pending);
        }

        pending.serverKilled ||= message.action === "KILLED";
        pending.messages.push(message);

        if (pending.messages.length > this.#limit) {
            pending.overflow = true;
            pending.messages.shift();
        }
    }

    /**
     * Subscribe to notifications for an id, replaying any that were buffered
     * before this subscriber attached. Returns an unsubscribe function.
     *
     * If provided, `onOverflow` is called instead of replaying an incomplete
     * buffer, with the maximum number of notifications that could be held.
     */
    subscribe(
        id: string,
        notify: (message: LiveMessage) => void,
        onOverflow?: (limit: number, serverKilled: boolean) => void,
    ): () => void {
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

            if (buffered.overflow && onOverflow) {
                onOverflow(this.#limit, buffered.serverKilled);
            } else {
                for (const message of buffered.messages) {
                    notify(message);
                }
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
