export class Option<T = unknown> {
    is_some(): this is Some<T> {
        return this instanceof Some;
    }

    is_none(): this is None<T> {
        return this instanceof None;
    }

    static some<T = unknown>(value: T): Some<T> {
        return new Some(value);
    }

    static none<T = unknown>(): None<T> {
        return new None();
    }
}

export class Some<T = unknown> extends Option<T> {
    value: T;

    constructor(value: T) {
        super();
        this.value = value;
    }
}

export class None<T = unknown> extends Option<T> {}