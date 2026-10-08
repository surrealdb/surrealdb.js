import { UUID, uuidv4obj, uuidv7obj } from "uuidv7";
import { JsonCodec } from "../codec/json/codec.ts";
import { isSharedArrayBuffer } from "../internal/shared-array-buffer.ts";
import { hasSymbol, markSymbol, UUID_SYMBOL } from "../utils/symbols.ts";
import { Value } from "./value.ts";

/**
 * A SurrealQL UUID value.
 */
export class Uuid extends Value {
    static override [Symbol.hasInstance](instance: unknown): boolean {
        return hasSymbol(instance, UUID_SYMBOL);
    }

    private readonly _inner: UUID;

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
    constructor(uuid: ArrayBufferLike | Uint8Array);

    // Shadow implementation
    constructor(uuid: Uuid | UUID | string | ArrayBufferLike | Uint8Array) {
        super();

        if (uuid instanceof ArrayBuffer || isSharedArrayBuffer(uuid)) {
            this._inner = UUID.ofInner(new Uint8Array(uuid));
        } else if (uuid instanceof Uint8Array) {
            this._inner = UUID.ofInner(uuid);
        } else if (uuid instanceof Uuid) {
            this._inner = uuid._inner;
        } else if (uuid instanceof UUID) {
            this._inner = uuid;
        } else {
            this._inner = UUID.parse(uuid);
        }
        markSymbol(this, UUID_SYMBOL);
    }

    equals(other: unknown): boolean {
        if (!(other instanceof Uuid)) return false;
        return this._inner.equals(other._inner);
    }

    toJSON(): unknown {
        if (Value._useExperimentalToJson) {
            return JsonCodec.DEFAULT.encode(this);
        }
        return this._inner.toString();
    }

    /**
     * @returns The string representation of the UUID
     */
    toString(): string {
        return this._inner.toString();
    }

    /**
     * Converts the UUID to a Uint8Array
     */
    toUint8Array(): Uint8Array {
        return this._inner.bytes;
    }

    /**
     * Converts the UUID to a ArrayBuffer
     */
    toBuffer(): ArrayBufferLike {
        return this._inner.bytes.buffer;
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
