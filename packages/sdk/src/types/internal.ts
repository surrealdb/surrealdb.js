import type { Jsonify } from "../utils";

export type MaybeJsonify<T, J extends boolean> = J extends true ? Jsonify<T> : T;
export type Prettify<T> = { [K in keyof T]: T[K] } & {};
