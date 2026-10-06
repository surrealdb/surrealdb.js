/**
 * A clock which only moves when the test says so, for code which waits on `setTimeout` and reads
 * `Date.now()`.
 *
 * Bun's own fake timers are not used, as they are not there in every version of Bun this is run
 * with. What this replaces is the timer functions and `Date.now`, until it is uninstalled.
 */
export class FakeClock {
    readonly #realSetTimeout = globalThis.setTimeout;
    readonly #realClearTimeout = globalThis.clearTimeout;
    readonly #realNow = Date.now;
    readonly #timers = new Map<number, { at: number; run: () => void }>();
    #now: number;
    #next = 1;
    #installed = false;

    constructor(start: Date) {
        this.#now = start.getTime();
    }

    /** The number of timers which are waiting */
    get timers(): number {
        return this.#timers.size;
    }

    install(): this {
        if (this.#installed) return this;

        this.#installed = true;

        globalThis.setTimeout = ((
            handler: (...args: unknown[]) => void,
            delay = 0,
            ...args: unknown[]
        ) => {
            const id = this.#next;

            this.#next = id + 1;

            this.#timers.set(id, {
                at: this.#now + Math.max(0, Number(delay) || 0),
                run: () => handler(...args),
            });

            return id;
        }) as unknown as typeof setTimeout;

        globalThis.clearTimeout = ((id?: number) => {
            if (id !== undefined) this.#timers.delete(id);
        }) as unknown as typeof clearTimeout;

        Date.now = () => this.#now;

        return this;
    }

    uninstall(): void {
        if (!this.#installed) return;

        this.#installed = false;
        this.#timers.clear();

        globalThis.setTimeout = this.#realSetTimeout;
        globalThis.clearTimeout = this.#realClearTimeout;
        Date.now = this.#realNow;
    }

    /**
     * Move the clock forward, running each timer which falls due at the time it is due, and
     * letting whatever it sets going run before the next. Timers which those schedule and which
     * fall due within the time are run as well.
     */
    async advance(milliseconds: number, settle: () => Promise<void>): Promise<void> {
        const target = this.#now + milliseconds;

        for (;;) {
            let due: [number, { at: number; run: () => void }] | undefined;

            for (const entry of this.#timers) {
                if (entry[1].at <= target && (!due || entry[1].at < due[1].at)) due = entry;
            }

            if (!due) break;

            this.#timers.delete(due[0]);
            this.#now = Math.max(this.#now, due[1].at);
            due[1].run();

            await settle();
        }

        this.#now = target;
        await settle();
    }
}
