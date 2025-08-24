import type { Jsonify } from "../utils";
import type { QueryStats } from "./surreal";

export type MaybeJsonify<T, J extends boolean> = J extends true ? Jsonify<T> : T;
export type Prettify<T> = { [K in keyof T]: T[K] } & {};

export interface ValueFrame<T, J extends boolean> {
    type: "value";
    value: MaybeJsonify<T, J>;
}

export interface ErrorFrame {
    type: "error";
    stats: QueryStats;
    error: {
        code: number;
        message: string;
    };
}

export interface DoneFrame {
    type: "done";
    stats: QueryStats;
}

export type Frame<T, J extends boolean> = ValueFrame<T, J> | ErrorFrame | DoneFrame;
