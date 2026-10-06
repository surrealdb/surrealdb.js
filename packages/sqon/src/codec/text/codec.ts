import { TextParseError } from "../../errors.ts";
import type { ValueCodec } from "../../types/codec.ts";
import { toSurqlString } from "../../utils/to-surql-string.ts";
import {
    DateTime,
    Decimal,
    Duration,
    FileRef,
    GeometryPoint,
    Range,
    RecordId,
    RecordIdRange,
    Table,
    Uuid,
} from "../../value/index.ts";
import { TextParser } from "./parser.ts";

/**
 * Options used to configure the {@link TextCodec}.
 */
export interface TextCodecOptions {
    /**
     * Use native `Date` objects instead of custom `DateTime` objects.
     * Using `Date` objects will result in a loss of nanosecond precision.
     */
    useNativeDates?: boolean;
}

/**
 * A codec for encoding and decoding SurrealQL values using the SQON text format.
 *
 * Encoding produces a SurrealQL value string; decoding parses a single
 * SurrealQL value back into native JavaScript values and SQON `Value`
 * derivatives, matching the output of the CBOR and JSON codecs.
 */
export class TextCodec implements ValueCodec<string> {
    /**
     * The default TextCodec instance.
     */
    static readonly DEFAULT: TextCodec = new TextCodec({});

    #options: TextCodecOptions;

    constructor(options: TextCodecOptions = {}) {
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
        return new TextParser(data, this.#options).parse() as T;
    }

    // ------------------------------------------------------------------
    // Typed static parse helpers
    // ------------------------------------------------------------------

    static #expect<T>(
        input: string,
        options: TextCodecOptions | undefined,
        expected: string,
        check: (value: unknown) => value is T,
    ): T {
        const value = new TextParser(input, options).parse();
        if (!check(value)) {
            throw new TextParseError(`Expected a ${expected} value`, 0);
        }
        return value;
    }

    /** Parse any single SQON value. */
    static parseValue(input: string, options?: TextCodecOptions): unknown {
        return new TextParser(input, options).parse();
    }

    /** Parse a string value. */
    static parseString(input: string, options?: TextCodecOptions): string {
        return TextCodec.#expect(
            input,
            options,
            "string",
            (v): v is string => typeof v === "string",
        );
    }

    /** Parse a numeric value (`int` as `number`/`bigint`, `float` as `number`). */
    static parseNumber(input: string, options?: TextCodecOptions): number | bigint {
        return TextCodec.#expect(
            input,
            options,
            "number",
            (v): v is number | bigint => typeof v === "number" || typeof v === "bigint",
        );
    }

    /** Parse a boolean value. */
    static parseBool(input: string, options?: TextCodecOptions): boolean {
        return TextCodec.#expect(
            input,
            options,
            "boolean",
            (v): v is boolean => typeof v === "boolean",
        );
    }

    /** Parse a decimal value. */
    static parseDecimal(input: string, options?: TextCodecOptions): Decimal {
        return TextCodec.#expect(
            input,
            options,
            "decimal",
            (v): v is Decimal => v instanceof Decimal,
        );
    }

    /** Parse a duration value. */
    static parseDuration(input: string, options?: TextCodecOptions): Duration {
        return TextCodec.#expect(
            input,
            options,
            "duration",
            (v): v is Duration => v instanceof Duration,
        );
    }

    /** Parse a datetime value (a `Date` when `useNativeDates` is set). */
    static parseDatetime(input: string, options?: TextCodecOptions): DateTime | Date {
        return TextCodec.#expect(
            input,
            options,
            "datetime",
            (v): v is DateTime | Date => v instanceof DateTime || v instanceof Date,
        );
    }

    /** Parse a UUID value. */
    static parseUuid(input: string, options?: TextCodecOptions): Uuid {
        return TextCodec.#expect(input, options, "uuid", (v): v is Uuid => v instanceof Uuid);
    }

    /** Parse a bytes value. */
    static parseBytes(input: string, options?: TextCodecOptions): Uint8Array {
        return TextCodec.#expect(
            input,
            options,
            "bytes",
            (v): v is Uint8Array => v instanceof Uint8Array,
        );
    }

    /** Parse a file reference value. */
    static parseFile(input: string, options?: TextCodecOptions): FileRef {
        return TextCodec.#expect(input, options, "file", (v): v is FileRef => v instanceof FileRef);
    }

    /** Parse a table value. */
    static parseTable(input: string, options?: TextCodecOptions): Table {
        return TextCodec.#expect(input, options, "table", (v): v is Table => v instanceof Table);
    }

    /** Parse a record id value. */
    static parseRecordId(input: string, options?: TextCodecOptions): RecordId {
        return TextCodec.#expect(
            input,
            options,
            "record id",
            (v): v is RecordId => v instanceof RecordId,
        );
    }

    /** Parse a record id range value. */
    static parseRecordIdRange(input: string, options?: TextCodecOptions): RecordIdRange {
        return TextCodec.#expect(
            input,
            options,
            "record id range",
            (v): v is RecordIdRange => v instanceof RecordIdRange,
        );
    }

    /** Parse a range value. */
    static parseRange(input: string, options?: TextCodecOptions): Range<unknown, unknown> {
        return TextCodec.#expect(
            input,
            options,
            "range",
            (v): v is Range<unknown, unknown> => v instanceof Range,
        );
    }

    /** Parse a geometry point value. */
    static parseGeometryPoint(input: string, options?: TextCodecOptions): GeometryPoint {
        return TextCodec.#expect(
            input,
            options,
            "geometry point",
            (v): v is GeometryPoint => v instanceof GeometryPoint,
        );
    }

    /** Parse an array value. */
    static parseArray(input: string, options?: TextCodecOptions): unknown[] {
        return TextCodec.#expect(input, options, "array", (v): v is unknown[] => Array.isArray(v));
    }

    /** Parse a set value. */
    static parseSet(input: string, options?: TextCodecOptions): Set<unknown> {
        return TextCodec.#expect(input, options, "set", (v): v is Set<unknown> => v instanceof Set);
    }

    /** Parse a plain object value. */
    static parseObject(input: string, options?: TextCodecOptions): Record<string, unknown> {
        return TextCodec.#expect(
            input,
            options,
            "object",
            (v): v is Record<string, unknown> =>
                typeof v === "object" &&
                v !== null &&
                !Array.isArray(v) &&
                Object.getPrototypeOf(v) === Object.prototype,
        );
    }
}
