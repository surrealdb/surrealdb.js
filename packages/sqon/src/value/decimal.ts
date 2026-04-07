import { JsonCodec } from "../codec/json/codec.ts";
import { InvalidDecimalError } from "../errors.ts";
import { DECIMAL_SYMBOL, hasSymbol, markSymbol } from "../utils/symbols.ts";
import { Value } from "./value.ts";

export type DecimalTuple = [bigint, bigint, number];

/**
 * A SurrealQL decimal number value with support for parsing, formatting, arithmetic, and high precision.
 */
export class Decimal extends Value {
    static override [Symbol.hasInstance](instance: unknown): boolean {
        return hasSymbol(instance, DECIMAL_SYMBOL);
    }

    readonly #int: bigint;
    readonly #frac: bigint;
    readonly #scale: number;

    constructor(input: Decimal);
    constructor(input: string);
    constructor(input: number | bigint);
    constructor(input: DecimalTuple);

    // Shadow implementation
    constructor(input: Decimal | string | number | bigint | DecimalTuple) {
        super();

        if (input instanceof Decimal) {
            this.#int = input.#int;
            this.#frac = input.#frac;
            this.#scale = input.#scale;
        } else if (typeof input === "bigint") {
            this.#int = input;
            this.#frac = 0n;
            this.#scale = 0;
        } else if (Array.isArray(input)) {
            let [int, frac, scale] = input;
            const maxFrac = 10n ** BigInt(scale);
            if (frac >= maxFrac) {
                int += frac / maxFrac;
                frac %= maxFrac;
            }
            this.#int = int;
            this.#frac = frac;
            this.#scale = scale;
        } else if (typeof input === "string" && /e/i.test(input)) {
            const dec = Decimal.fromScientificNotation(input);
            this.#int = dec.#int;
            this.#frac = dec.#frac;
            this.#scale = dec.#scale;
        } else {
            const str = input.toString().trim();
            const isNegative = str.startsWith("-");
            const clean = isNegative ? str.slice(1) : str;
            const [intStrRaw, fracStrRaw = ""] = clean.split(".");

            const safeInt = /^\d+$/.test(intStrRaw) ? intStrRaw : "0";
            const safeFrac = /^\d+$/.test(fracStrRaw) ? fracStrRaw : "0";

            const intStr = safeInt || "0";
            const fracStr = safeFrac.padEnd(safeFrac.length || 1, "0");

            const absInt = BigInt(intStr);
            const absFrac = BigInt(fracStr);

            this.#int = isNegative ? -absInt : absInt;
            this.#frac = isNegative ? -absFrac : absFrac;
            this.#scale = safeFrac.length;
        }
        markSymbol(this, DECIMAL_SYMBOL);
    }

    equals(other: unknown): boolean {
        if (!(other instanceof Decimal)) return false;
        const a = this.toBigIntWithScale();
        const b = other.toBigIntWithScale();
        const scale = Math.max(a.scale, b.scale);
        const aVal = a.value * 10n ** BigInt(scale - a.scale);
        const bVal = b.value * 10n ** BigInt(scale - b.scale);
        return aVal === bVal;
    }

    toJSON(): unknown {
        if (Value._useExperimentalToJson) {
            return JsonCodec.DEFAULT.encode(this);
        }
        return this.toString();
    }

    toString(): string {
        const sign = this.#int < 0n || this.#frac < 0n ? "-" : "";
        const absInt = this.#int < 0n ? -this.#int : this.#int;
        const absFrac = this.#frac < 0n ? -this.#frac : this.#frac;

        if (this.#scale === 0) {
            return `${sign}${absInt}`;
        }

        let fracStr = absFrac.toString().padStart(this.#scale, "0");

        let end = fracStr.length;
        while (end > 0 && fracStr.charCodeAt(end - 1) === 48) {
            end--;
        }
        fracStr = fracStr.slice(0, end);

        return fracStr === "" ? `${sign}${absInt}` : `${sign}${absInt}.${fracStr}`;
    }

    get int(): bigint {
        return this.#int;
    }

    get frac(): bigint {
        return this.#frac;
    }

    get scale(): number {
        return this.#scale;
    }

    add(other: Decimal): Decimal {
        const a = this.toBigIntWithScale();
        const b = other.toBigIntWithScale();
        const scale = Math.max(a.scale, b.scale);
        const scaleDiffA = BigInt(scale - a.scale);
        const scaleDiffB = BigInt(scale - b.scale);
        const valA = a.value * 10n ** scaleDiffA;
        const valB = b.value * 10n ** scaleDiffB;
        const sum = valA + valB;
        const intPart = sum / 10n ** BigInt(scale);
        const fracPart = sum % 10n ** BigInt(scale);
        return new Decimal([intPart, fracPart, scale]);
    }

    sub(other: Decimal): Decimal {
        const a = this.toBigIntWithScale();
        const b = other.toBigIntWithScale();
        const scale = Math.max(a.scale, b.scale);
        const factorA = 10n ** BigInt(scale - a.scale);
        const factorB = 10n ** BigInt(scale - b.scale);
        const valA = a.value * factorA;
        const valB = b.value * factorB;
        const result = valA - valB;
        const intPart = result / 10n ** BigInt(scale);
        const fracPart = result % 10n ** BigInt(scale);
        return new Decimal([intPart, fracPart, scale]);
    }

    mul(other: Decimal): Decimal {
        const a = this.toBigIntWithScale();
        const b = other.toBigIntWithScale();
        const result = a.value * b.value;
        const scale = a.scale + b.scale;
        const intPart = result / 10n ** BigInt(scale);
        const fracPart = result % 10n ** BigInt(scale);
        return new Decimal([intPart, fracPart, scale]);
    }

    div(other: Decimal): Decimal {
        const a = this.toBigIntWithScale();
        const b = other.toBigIntWithScale();
        if (b.value === 0n) throw new InvalidDecimalError("Division by zero");
        const targetScale = 38;
        const scaleDiff = BigInt(targetScale + b.scale - a.scale);
        const scaledA = a.value * 10n ** scaleDiff;
        const result = scaledA / b.value;
        const intPart = result / 10n ** BigInt(targetScale);
        const fracPart = result % 10n ** BigInt(targetScale);
        return new Decimal([intPart, fracPart, targetScale]);
    }

    mod(other: Decimal): Decimal {
        const a = this.toBigIntWithScale();
        const b = other.toBigIntWithScale();

        if (b.value === 0n) throw new InvalidDecimalError("Modulo by zero");

        const scale = Math.max(a.scale, b.scale);
        const scaleDiffA = BigInt(scale - a.scale);
        const scaleDiffB = BigInt(scale - b.scale);

        const valA = a.value * 10n ** scaleDiffA;
        const valB = b.value * 10n ** scaleDiffB;

        const result = valA % valB;
        const intPart = result / 10n ** BigInt(scale);
        const fracPart = result % 10n ** BigInt(scale);

        return new Decimal([intPart, fracPart, scale]);
    }

    abs(): Decimal {
        return this.#int < 0n || this.#frac < 0n
            ? new Decimal([
                  this.#int < 0n ? -this.#int : this.#int,
                  this.#frac < 0n ? -this.#frac : this.#frac,
                  this.#scale,
              ])
            : this;
    }

    neg(): Decimal {
        return new Decimal([-this.#int, -this.#frac, this.#scale]);
    }

    isZero(): boolean {
        return this.#int === 0n && this.#frac === 0n;
    }

    isNegative(): boolean {
        return this.#int < 0n || (this.#int === 0n && this.#frac < 0n);
    }

    compare(other: Decimal): number {
        const a = this.toBigIntWithScale();
        const b = other.toBigIntWithScale();
        const scale = Math.max(a.scale, b.scale);
        const aVal = a.value * 10n ** BigInt(scale - a.scale);
        const bVal = b.value * 10n ** BigInt(scale - b.scale);
        if (aVal < bVal) return -1;
        if (aVal > bVal) return 1;
        return 0;
    }

    round(precision: number): Decimal {
        if (precision < 0) throw new InvalidDecimalError("Precision must be >= 0");

        const full = this.toBigIntWithScale();

        if (this.#scale <= precision) {
            const factor = 10n ** BigInt(precision - this.#scale);
            const newValue = full.value * factor;
            const intPart = newValue / 10n ** BigInt(precision);
            const fracPart = newValue % 10n ** BigInt(precision);
            return new Decimal([intPart, fracPart, precision]);
        }

        const factor = 10n ** BigInt(this.#scale - precision);
        const half = factor / 2n;
        const rounded =
            full.value >= 0n ? (full.value + half) / factor : (full.value - half) / factor;
        const intPart = rounded / 10n ** BigInt(precision);
        const fracPart = rounded % 10n ** BigInt(precision);
        return new Decimal([intPart, fracPart, precision]);
    }

    toFixed(precision: number): string {
        const rounded = this.round(precision);
        const sign = rounded.int < 0n || rounded.frac < 0n ? "-" : "";
        const absInt = rounded.int < 0n ? -rounded.int : rounded.int;

        if (precision === 0) {
            return `${sign}${absInt}`;
        }

        const absFrac = rounded.frac < 0n ? -rounded.frac : rounded.frac;
        const fracStr = absFrac.toString().padStart(precision, "0");
        return `${sign}${absInt}.${fracStr}`;
    }

    toFloat(): number {
        return Number(this.toString());
    }

    toBigInt(): bigint {
        if (this.#int >= 0n) return this.#int;
        if (this.#frac !== 0n) return this.#int - 1n;
        return this.#int;
    }

    toParts(): { int: bigint; frac: bigint; scale: number } {
        return {
            int: this.#int,
            frac: this.#frac,
            scale: this.#scale,
        };
    }

    toScientific(): string {
        if (this.isZero()) return "0e0";

        const negative = this.isNegative();
        const abs = negative ? this.neg() : this;
        const str = abs.toString();
        const [intPart, fracPart = ""] = str.split(".");
        const raw = (intPart + fracPart).replace(/^0+/, "");
        const firstSig = raw.search(/[1-9]/);
        if (firstSig === -1) return "0e0";

        let exponent: number;
        if (intPart !== "0") {
            exponent = intPart.length - 1;
        } else {
            let leading = 0;
            while (leading < fracPart.length && fracPart.charCodeAt(leading) === 48) leading++;
            exponent = -leading - 1;
        }

        let end = raw.length;
        while (end > 0 && raw.charCodeAt(end - 1) === 48) end--;
        const digits = raw.slice(0, end);
        const mantissa = digits.length > 1 ? `${digits[0]}.${digits.slice(1)}` : digits[0];
        return `${negative ? "-" : ""}${mantissa}e${exponent}`;
    }

    static fromScientificNotation(input: string): Decimal {
        const trimmed = input.trim();

        if (!/^[+-]?\d+(\.\d+)?[eE][+-]?\d+$/.test(trimmed)) {
            throw new InvalidDecimalError(`Invalid scientific notation: ${input}`);
        }

        const [baseStr, expStr] = trimmed.split(/[eE]/);
        const exp = Number.parseInt(expStr, 10);
        const negative = baseStr.startsWith("-");
        const [intPart, fracPart = ""] = baseStr.replace(/^[-+]/, "").split(".");

        const raw = intPart + fracPart;
        let start = 0;
        while (start < raw.length && raw.charCodeAt(start) === 48) start++;
        const digits = raw.slice(start) || "0";

        const pointIndex = intPart.length;
        const newPointIndex = pointIndex + exp;

        let result: string;
        if (newPointIndex <= 0) {
            result = `0.${"0".repeat(-newPointIndex)}${digits}`;
        } else if (newPointIndex >= digits.length) {
            result = digits + "0".repeat(newPointIndex - digits.length);
        } else {
            result = `${digits.slice(0, newPointIndex)}.${digits.slice(newPointIndex)}`;
        }

        return new Decimal(negative ? `-${result}` : result);
    }

    private toBigIntWithScale(): { value: bigint; scale: number } {
        return {
            value: this.#int * 10n ** BigInt(this.#scale) + this.#frac,
            scale: this.#scale,
        };
    }
}
