import { SurrealError } from "../errors.ts";
import type { CodecOptions, ValueCodec } from "../types/codec.ts";

/**
 * A class used to encode and decode SurrealQL values using FlatBuffers
 */
export class FlatBufferCodec implements ValueCodec<Uint8Array> {
    static default = new FlatBufferCodec({});

    // biome-ignore lint/correctness/noUnusedPrivateClassMembers: Todo
    #options: CodecOptions;

    constructor(options: CodecOptions) {
        this.#options = options;
    }

    encode<T>(_data: T): Uint8Array {
        throw new SurrealError("FlatBuffer encoding is not supported in this version");
    }

    decode<T>(_data: Uint8Array): T {
        throw new SurrealError("FlatBuffer decoding is not supported in this version");
    }
}
