// Why is the default value being stored in an array? undefined, null, false, etc... are all valid defaults,
// and specifying a field on a class as optional will make it undefined by default.

export type Fill<T = unknown> = [Gap<T>, T];
export class Gap<T = unknown> {
    readonly args: [T?] = [];
    constructor(...args: [T?]) {
        this.args = args;
    }

    fill(value: T): Fill<T> {
        return [this, value];
    }

    hasDefault(): boolean {
        return this.args.length === 1;
    }

    get default(): T | undefined {
        return this.args[0];
    }
}
