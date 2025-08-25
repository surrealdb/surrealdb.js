import { type Jsonify, jsonify } from "../utils";

export type MaybeJsonify<T, J extends boolean> = J extends true ? Jsonify<T> : T;

export function maybeJsonify<T, J extends boolean>(value: T, apply: J): MaybeJsonify<T, J> {
    return (apply ? jsonify(value) : value) as MaybeJsonify<T, J>;
}
