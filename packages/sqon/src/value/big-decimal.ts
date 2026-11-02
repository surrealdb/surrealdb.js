import { JsonCodec } from "../codec/json/codec.ts";
import { InvalidDecimalError } from "../errors.ts";
import { BIG_DECIMAL_SYMBOL, hasSymbol, markSymbol } from "../utils/symbols.ts";
import { Decimal } from "./decimal.ts";
import { Value } from "./value.ts";

const NUMBER = /^-?\d+(\.\d+)?([eE][+-]?\d+)?$/;

/**
 * A SurrealDB 4.0 `bigdecimal`: a decimal of arbitrary precision, past the 28 significant
 * digits of a `decimal`. It keeps the text the server writes, in positional notation, and
 * converts to a {@link Decimal} for arithmetic, which loses nothing.
 *
 * A `cbor.2` connection reads a `bigdecimal` the server cannot write as a `decimal` as a
 * `BigDecimal`, and sends one as tag 192. Plain `cbor` has no bigdecimal: the server sends one
 * as a decimal when it fits one and as text otherwise, and the SDK sends a `BigDecimal` the same
 * way.
 */
export class BigDecimal extends Value {
    static override [Symbol.hasInstance](instance: unknown): boolean {
        return hasSymbol(instance, BIG_DECIMAL_SYMBOL);
    }

    readonly #text: string;

    /**
     * A bigdecimal from its text, in positional or scientific notation, or from a
     * {@link Decimal}, a `bigint` or an integer `number`
     */
    constructor(input: string | bigint | number | Decimal | BigDecimal) {
        super();

        if (input instanceof BigDecimal) {
            this.#text = input.#text;
        } else if (input instanceof Decimal) {
            this.#text = input.toString();
        } else if (typeof input === "bigint") {
            this.#text = input.toString();
        } else if (typeof input === "number") {
            if (!Number.isSafeInteger(input)) {
                throw new InvalidDecimalError(
                    `A bigdecimal is made from an exact number: pass ${input} as text`,
                );
            }
            this.#text = input.toString();
        } else {
            const text = input.trim();
            if (!NUMBER.test(text)) {
                throw new InvalidDecimalError(`Invalid bigdecimal: ${JSON.stringify(input)}`);
            }
            // Kept in the positional notation the server writes and reads
            this.#text = /e/i.test(text) ? new Decimal(text).toString() : text;
        }

        markSymbol(this, BIG_DECIMAL_SYMBOL);
    }

    /**
     * Whether a SurrealDB `decimal` holds the value exactly: a coefficient below 2^96 with at
     * most 28 digits after the point, as the server's `rust_decimal` does. The server writes such
     * a bigdecimal as a decimal, and the SDK sends one the same way.
     */
    fitsDecimal(): boolean {
        const { int, frac, scale } = this.toDecimal().toParts();
        let places = scale;
        let coefficient =
            (int < 0n ? -int : int) * 10n ** BigInt(scale) + (frac < 0n ? -frac : frac);
        // The parts keep trailing zeros, such as the one place of an integer, which hold nothing
        while (places > 0 && coefficient % 10n === 0n) {
            coefficient /= 10n;
            places--;
        }
        return places <= 28 && coefficient < 2n ** 96n;
    }

    /**
     * The value as a {@link Decimal}, which holds it exactly
     */
    toDecimal(): Decimal {
        return new Decimal(this.#text);
    }

    /**
     * Equal to a bigdecimal or decimal of the same value, whatever its notation
     */
    equals(other: unknown): boolean {
        if (other instanceof BigDecimal) other = other.toDecimal();
        return other instanceof Decimal && this.toDecimal().compare(other) === 0;
    }

    toJSON(): unknown {
        if (Value._useExperimentalToJson) {
            return JsonCodec.DEFAULT.encode(this);
        }
        return this.toString();
    }

    /**
     * The text of the value, as it was made or as the server wrote it
     */
    toString(): string {
        return this.#text;
    }
}
