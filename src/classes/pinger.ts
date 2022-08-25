export default class Pinger {

    #pinger: number | undefined = undefined;
    #interval: number | undefined = undefined;

    constructor(interval: number = 30000) {
        this.#interval = interval;
    }

    start(func: Function) {
        this.#pinger = setInterval(func, this.#interval);
    }

    stop() {
        clearInterval(this.#pinger);
    }

}
