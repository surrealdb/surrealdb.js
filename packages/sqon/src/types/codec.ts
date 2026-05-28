/**
 * Options used to configure the value codec
 */
export interface CodecOptions {
    /** Use native `Date` objects instead of custom `DateTime` objects. Using `Date` objects will result in a loss of nanosecond precision. */
    useNativeDates?: boolean;
    /** Specify a custom visitor function to process encode values. */
    valueEncodeVisitor?: (value: unknown) => unknown;
    /** Specify a custom visitor function to process decode values. */
    valueDecodeVisitor?: (value: unknown) => unknown;
}

/**
 * A codec for encoding and decoding SurrealQL values.
 *
 * The `Wire` generic controls the serialised format:
 * - `Uint8Array` for binary codecs (CBOR, FlatBuffer)
 * - `unknown` for structured codecs (JSON) that produce a plain object tree
 *
 * Defaults to `Uint8Array` for backward compatibility.
 */
export interface ValueCodec<Wire = Uint8Array> {
    encode<T>(data: T): Wire;
    decode<T>(data: Wire): T;
}
