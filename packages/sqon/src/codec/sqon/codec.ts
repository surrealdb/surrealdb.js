import type { ValueCodec } from "../../types/codec.ts";
import { toSurqlString } from "../../utils/to-surql-string.ts";
import { type SqonParseOptions, SqonParser } from "./parser.ts";

/**
 * Options used to configure the {@link SqonCodec}.
 */
export interface SqonCodecOptions extends SqonParseOptions {}

/**
 * A codec for encoding and decoding SurrealQL values using the SQON text format.
 *
 * Encoding produces a SurrealQL value string; decoding parses a single
 * SurrealQL value back into native JavaScript values and SQON `Value`
 * derivatives, matching the output of the CBOR and JSON codecs.
 */
export class SqonCodec implements ValueCodec<string> {
    /**
     * The default SqonCodec instance.
     */
    static readonly DEFAULT: SqonCodec = new SqonCodec({});

    #options: SqonCodecOptions;

    constructor(options: SqonCodecOptions = {}) {
        this.#options = options;
    }

    /**
     * Encode a value into its SurrealQL text representation.
     */
    encode<T>(data: T): string {
        return toSurqlString(data);
    }

    /**
     * Decode a SurrealQL value string into value instances.
     */
    decode<T>(data: string): T {
        return new SqonParser(data, this.#options).parse() as T;
    }
}
