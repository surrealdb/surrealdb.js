import { PublishError } from "../errors";
import type { EventPayload, EventPublisher } from "../types/publisher";

export class Publisher<T extends EventPayload> implements EventPublisher<T> {
    #subscriptions: Partial<{
        [K in keyof T]: Set<(...event: T[K]) => void>;
    }> = {};

    subscribe<K extends keyof T>(event: K, listener: (...event: T[K]) => void): () => void {
        this.#subscriptions[event] ??= new Set();
        this.#subscriptions[event]?.add(listener);

        return () => {
            const subscriptions = this.#subscriptions[event];

            if (subscriptions?.delete(listener) && subscriptions.size === 0) {
                delete this.#subscriptions[event];
            }
        };
    }

    subscribeFirst<K extends keyof T>(...events: K[]): Promise<T[K]> {
        const subscriptions: (() => void)[] = [];

        return new Promise((resolve) => {
            for (const event of events) {
                const unsubscribe = this.subscribe(event, (...payload: T[K]) => {
                    for (const subscription of subscriptions) {
                        subscription();
                    }

                    resolve(payload);
                });

                subscriptions.push(unsubscribe);
            }
        });
    }

    publish<K extends keyof T>(event: K, ...payload: T[K]): void {
        const subscriptions = this.#subscriptions[event];

        if (!subscriptions) {
            return;
        }

        const failures: unknown[] = [];

        for (const subscription of subscriptions) {
            try {
                subscription(...payload);
            } catch (cause) {
                failures.push(cause);
            }
        }

        if (failures.length > 0) {
            throw new PublishError(failures);
        }
    }
}
