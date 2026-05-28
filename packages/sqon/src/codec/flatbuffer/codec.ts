import { SqonError } from "../../errors.ts";
import type { CodecOptions, ValueCodec } from "../../types/codec.ts";

/**
 * A codec for encoding and decoding SurrealQL values using the SQON Binary (flatbuffer) format.
 *
 * *Note*: This codec is not implemented in this version.
 */
export class FlatBufferCodec implements ValueCodec<Uint8Array> {
    /**
     * The default FlatBufferCodec instance.
     */
    static readonly DEFAULT: FlatBufferCodec = new FlatBufferCodec({});

    // biome-ignore lint/correctness/noUnusedPrivateClassMembers: Todo
    #options: CodecOptions;

    constructor(options: CodecOptions) {
        this.#options = options;
    }

    encode<T>(_data: T): Uint8Array {
        throw new SqonError("FlatBuffer encoding is not supported in this version");
    }

    decode<T>(_data: Uint8Array): T {
        throw new SqonError("FlatBuffer decoding is not supported in this version");
    }
}
