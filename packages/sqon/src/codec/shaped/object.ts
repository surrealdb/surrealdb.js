/**
 * Building objects out of keys which came off the wire.
 *
 * A field name is whatever the table's is, so it may be `__proto__`, `constructor`, or anything
 * else JavaScript gives a meaning to. Reading or writing one of those with the ordinary syntax
 * reaches the prototype chain rather than the object, which silently loses the field — so every
 * place in this codec which handles a name from outside goes through here instead.
 */

/**
 * Puts `value` under `name` on `object`.
 *
 * `__proto__` is a setter inherited from `Object.prototype`: assigning it would set the object's
 * prototype and drop the field, and an object value would become the prototype itself.
 */
export function define(object: Record<string, unknown>, name: string, value: unknown): void {
    if (name === "__proto__") {
        Object.defineProperty(object, name, {
            value,
            writable: true,
            enumerable: true,
            configurable: true,
        });
        return;
    }
    object[name] = value;
}

/**
 * The keys `object` holds itself.
 *
 * `for...in` walks the prototype chain, so anything enumerable on `Object.prototype` — which a
 * page or a dependency may have put there — would be read as a field of every row and sent to
 * the server. The CBOR path walks own entries, and so does this.
 */
export function ownKeys(object: Record<string, unknown>): string[] {
    return Object.keys(object);
}
