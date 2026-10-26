import type { ValueCodec } from "@surrealdb/sqon";
import type { CodecRegistry } from "../types/surreal";

/**
 * The formats of the RPC wire. `cbor` is what every server speaks. SurrealDB 4.0 adds `cbor.2`,
 * which is `cbor` plus the tags of its sized numbers, byte for byte the same for every other
 * value; and `shaped`, which is `cbor.2` with each list of result rows written as a tag 57
 * block. A server before 4.0 offers only `cbor`.
 *
 * Each format has one name, but the server spells it differently on each transport: over
 * WebSocket it is the subprotocol, and over HTTP it is the media type, where `cbor.2` is
 * `application/cbor` with the parameter `v=2`. Those are the server's names, as the
 * surrealdb-protocol spec lists them (`spec/cbor-tags.yaml`, `spec/catalogs/http.yaml`).
 *
 * The two negotiate differently, because the WebSocket handshake picks one name for the
 * connection while an HTTP request names its format every time:
 *
 * - Over WebSocket the server picks the first entry of ITS OWN list — json, cbor.2, cbor,
 *   flatbuffers, shaped — which the client offered, not the client's first choice. `shaped`
 *   comes last there, so offering "shaped, cbor" gets `cbor`: it has to be offered alone, and a
 *   client which wants it reconnects offering the cbor ladder when the handshake fails, as it
 *   does against a server before 4.0 which does not know the name.
 * - Over HTTP a request asks for `shaped` in `Accept` while its body stays CBOR. From 4.0 a
 *   `Content-Type` of `application/cbor` or `application/cbor; v=2` may take an `Accept` of
 *   `application/cbor; v=2` or `application/vnd.surrealdb.shaped`; every other pair must match.
 */

/** `cbor` as a WebSocket subprotocol */
export const CBOR_PROTOCOL = "cbor";

/** `cbor.2` as a WebSocket subprotocol */
export const CBOR2_PROTOCOL = "cbor.2";

/** `shaped` as a WebSocket subprotocol */
export const SHAPED_PROTOCOL = "shaped";

/** `cbor` as an HTTP media type */
export const CBOR_MEDIA_TYPE = "application/cbor";

/** `cbor.2` as an HTTP media type: the CBOR media type at version 2 */
export const CBOR2_MEDIA_TYPE = "application/cbor; v=2";

/** `shaped` as an HTTP media type */
export const SHAPED_MEDIA_TYPE = "application/vnd.surrealdb.shaped";

/**
 * The WebSocket subprotocols to offer, in order of preference.
 */
export function cborProtocols(codecs: CodecRegistry): string[] {
    return codecs.cbor2 ? [CBOR2_PROTOCOL, CBOR_PROTOCOL] : [CBOR_PROTOCOL];
}

/**
 * Whether an HTTP response is written in `shaped`: a `Content-Type` of
 * `application/vnd.surrealdb.shaped`, among any parameters and however it is spaced or cased.
 */
export function isShapedMediaType(contentType: string | null): boolean {
    return (
        !!contentType &&
        /^application\/vnd\.surrealdb\.shaped\s*(;|$)/i.test(contentType.trimStart())
    );
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

/**
 * The codec for messages in the format a connection settled on, named as the transport names
 * it: a WebSocket subprotocol, or the media type of an HTTP response.
 */
export function wireCodec(codecs: CodecRegistry, format: string | null): ValueCodec<Uint8Array> {
    if (codecs.shaped && (format === SHAPED_PROTOCOL || isShapedMediaType(format))) {
        return codecs.shaped;
    }
    return cborCodec(codecs, format === CBOR2_PROTOCOL || isCbor2MediaType(format));
}
