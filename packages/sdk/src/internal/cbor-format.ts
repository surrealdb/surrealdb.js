import type { ValueCodec } from "@surrealdb/sqon";
import type { CodecRegistry } from "../types/surreal";

/**
 * The CBOR dialects of the RPC wire. `cbor` is what every server speaks. SurrealDB 4.0 adds
 * `cbor.2`, which is `cbor` plus the tags of its sized numbers, byte for byte the same for
 * every other value. A server before 4.0 offers only `cbor`, so a connection offers `cbor.2`
 * first and speaks whichever the server picks.
 *
 * Each dialect has one name, but the server spells it differently on each transport: over
 * WebSocket it is the subprotocol, and over HTTP it is the media type, where `cbor.2` is
 * `application/cbor` with the parameter `v=2`. Those are the server's names, as the
 * surrealdb-protocol spec lists them (`spec/cbor-tags.yaml`, `spec/catalogs/http.yaml`).
 */

/** `cbor` as a WebSocket subprotocol */
export const CBOR_PROTOCOL = "cbor";

/** `cbor.2` as a WebSocket subprotocol */
export const CBOR2_PROTOCOL = "cbor.2";

/** `cbor` as an HTTP media type */
export const CBOR_MEDIA_TYPE = "application/cbor";

/** `cbor.2` as an HTTP media type: the CBOR media type at version 2 */
export const CBOR2_MEDIA_TYPE = "application/cbor; v=2";

/**
 * The WebSocket subprotocols to offer, in order of preference.
 */
export function cborProtocols(codecs: CodecRegistry): string[] {
    return codecs.cbor2 ? [CBOR2_PROTOCOL, CBOR_PROTOCOL] : [CBOR_PROTOCOL];
}

/**
 * Whether an HTTP response is written in `cbor.2`: a `Content-Type` of `application/cbor` with
 * the parameter `v=2`, among any others and however it is spaced or cased.
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
