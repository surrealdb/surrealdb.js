import { UUID, uuidv4obj, uuidv7obj } from "uuidv7";
import { Value } from "./value";

/**
 * A SurrealQL UUID value.
 */
export class Uuid extends Value {
    readonly #inner: UUID;

    /**
     * Constructs a new Uuid by cloning an existing uuid
     *
     * @param input Uuid input
     */
    constructor(uuid: Uuid | UUID);

    /**
     * Constructs a new Uuid from a string representation
     *
     * @param uuid String input
     */
    constructor(uuid: string);

    /**
     * Constructs a new Uuid from a binary representation
     *
     * @param uuid ArrayBuffer or Uint8Array input
     */
    constructor(uuid: ArrayBuffer | Uint8Array);

    // Shadow implementation
    constructor(uuid: Uuid | UUID | string | ArrayBuffer | Uint8Array) {
        super();

        if (uuid instanceof ArrayBuffer) {
            this.#inner = UUID.ofInner(new Uint8Array(uuid));
        } else if (uuid instanceof Uint8Array) {
            this.#inner = UUID.ofInner(uuid);
        } else if (uuid instanceof Uuid) {
            this.#inner = uuid.#inner;
        } else if (uuid instanceof UUID) {
            this.#inner = uuid;
        } else {
            this.#inner = UUID.parse(uuid);
        }
    }

    equals(other: unknown): boolean {
        if (!(other instanceof Uuid)) return false;
        return this.#inner.equals(other.#inner);
    }

    toJSON(): string {
        return this.#inner.toString();
    }

    /**
     * @returns The string representation of the UUID
     */
    toString(): string {
        return this.#inner.toString();
    }

    /**
     * Converts the UUID to a Uint8Array
     */
    toUint8Array(): Uint8Array {
        return this.#inner.bytes;
    }

    /**
     * Converts the UUID to a ArrayBuffer
     */
    toBuffer(): ArrayBufferLike {
        return this.#inner.bytes.buffer;
    }

    /**
     * Generate a new UUID v4
     */
    static v4(): Uuid {
        return new Uuid(uuidv4obj());
    }

    /**
     * Generate a new UUID v7
     */
    static v7(): Uuid {
        return new Uuid(uuidv7obj());
    }
}
