import type { ValueCodec } from "@surrealdb/sqon";
import type { CodecRegistry } from "../types/surreal";

/**
 * The CBOR dialects of the RPC wire. `cbor` is what every server speaks. SurrealDB 4.0 adds
 * `cbor.2`, which is `cbor` plus the tags of its sized numbers, byte for byte the same for
 * every other value. A server before 4.0 offers only `cbor`, so a connection offers `cbor.2`
 * first and speaks whichever the server picks.
 */

/** The WebSocket subprotocol of plain CBOR */
export const CBOR_PROTOCOL = "cbor";

/** The WebSocket subprotocol of CBOR with the sized numbers of SurrealDB 4.0 */
export const CBOR2_PROTOCOL = "cbor.2";

/** The media type of plain CBOR */
export const CBOR_MEDIA_TYPE = "application/cbor";

/** The media type of CBOR with the sized numbers of SurrealDB 4.0 */
export const CBOR2_MEDIA_TYPE = "application/cbor; v=2";

/**
 * The WebSocket subprotocols to offer, in order of preference.
 */
export function cborProtocols(codecs: CodecRegistry): string[] {
    return codecs.cbor2 ? [CBOR2_PROTOCOL, CBOR_PROTOCOL] : [CBOR_PROTOCOL];
}

/**
 * Whether a response is written in `cbor.2`, from its `Content-Type`.
 */
export function isCbor2MediaType(contentType: string | null): boolean {
    return !!contentType && /^application\/cbor\s*;(.*;)?\s*v\s*=\s*2\s*(;|$)/i.test(contentType);
}

/**
 * The codec for messages in a dialect: `cbor.2` when it is the one in use and there is a codec
 * for it, `cbor` otherwise.
 */
export function cborCodec(codecs: CodecRegistry, cbor2: boolean): ValueCodec<Uint8Array> {
    return cbor2 && codecs.cbor2 ? codecs.cbor2 : codecs.cbor;
}
