
export default class Emitter {

    #events: { [key: string]: Function[] } = {};

    on(e: string, func: Function) {
        if (this.#events[e] === undefined) {
            this.#events[e] = [];
        }
        this.#events[e].push(func);
    }

    off(e: string, func: Function) {
        if (typeof this.#events[e] !== undefined) {
            const idx = this.#events[e].indexOf(func);
            if (idx > -1) {
                this.#events[e].splice(idx, 1);
            }
        }
    }

    once(e: string, func: Function) {
        this.on(e, function f(...args: string[]) {
            this.off(e, f);
            func.apply(this, args);
        });
    }

    emit(e: string, ...args: any) {
        if (typeof this.#events[e] !== undefined) {
            this.#events[e].forEach((func: Function) => {
                func.apply(this, args);
            });
        }
    }

    removeAllListeners(e?: string) {
        if (e) {
            if (typeof this.#events[e] !== undefined) {
                this.#events[e] = undefined;
            }
        } else {
            for (const e in this.#events) {
                this.#events[e] = undefined;
            }
        }
    }

}