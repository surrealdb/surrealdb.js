import { SurrealError } from "../errors";
import type { CodecOptions, ValueCodec } from "../types";

/**
 * A class used to encode and decode SurrealQL values using FlatBuffers
 */
export class FlatBufferCodec implements ValueCodec {
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
