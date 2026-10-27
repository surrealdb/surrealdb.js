import { JsonCodec } from "../codec/json/codec.ts";
import { InvalidNumberError } from "../errors.ts";
import { hasSymbol, markSymbol, SIZED_NUMBER_SYMBOL } from "../utils/symbols.ts";
import { Value } from "./value.ts";

/**
 * The fixed-width number kinds of SurrealDB 4.0.
 */
export type SizedNumberKind = "i8" | "u8" | "i16" | "u16" | "i32" | "u32" | "u64" | "f16" | "f32";

const INTEGER_RANGES = {
    i8: [-(2n ** 7n), 2n ** 7n - 1n],
    u8: [0n, 2n ** 8n - 1n],
    i16: [-(2n ** 15n), 2n ** 15n - 1n],
    u16: [0n, 2n ** 16n - 1n],
    i32: [-(2n ** 31n), 2n ** 31n - 1n],
    u32: [0n, 2n ** 32n - 1n],
    u64: [0n, 2n ** 64n - 1n],
} as const;

function checkInteger(kind: keyof typeof INTEGER_RANGES, value: number | bigint): bigint {
    if (typeof value === "number" && !Number.isSafeInteger(value)) {
        throw new InvalidNumberError(`${value} is not an integer which ${kind} can hold exactly`);
    }

    const int = BigInt(value);
    const [min, max] = INTEGER_RANGES[kind];

    if (int < min || int > max) {
        throw new InvalidNumberError(`${int} is outside the range of ${kind} (${min} to ${max})`);
    }

    return int;
}

/**
 * The exponent of the highest power of two not above `a`, for a positive finite `a`.
 */
function floorLog2(a: number): number {
    let e = Math.floor(Math.log2(a));
    if (2 ** e > a) e--;
    else if (2 ** (e + 1) <= a) e++;
    return e;
}

/**
 * Round a number to the nearest IEEE 754 half-precision value, ties to even.
 */
export function f16round(value: number): number {
    if (!Number.isFinite(value) || value === 0) return value;

    const sign = Math.sign(value);
    const abs = Math.abs(value);

    // Half the gap past the largest half (65504) rounds to infinity
    if (abs >= 65520) return sign * Number.POSITIVE_INFINITY;

    const exponent = floorLog2(abs);
    const quantum = exponent < -14 ? 2 ** -24 : 2 ** (exponent - 10);
    const steps = abs / quantum;
    let rounded = Math.round(steps);
    if (rounded - steps === 0.5 && rounded % 2 !== 0) rounded--;

    return sign * rounded * quantum;
}

/**
 * The bits of a half-precision float, for a value which a half holds exactly.
 */
export function f16Bits(value: number): number {
    if (Number.isNaN(value)) return 0x7e00;

    const sign = value < 0 || Object.is(value, -0) ? 0x8000 : 0;
    const abs = Math.abs(value);

    if (abs === Number.POSITIVE_INFINITY) return sign | 0x7c00;
    if (abs === 0) return sign;
    if (abs < 2 ** -14) return sign | (abs / 2 ** -24);

    const exponent = floorLog2(abs);
    return sign | ((exponent + 15) << 10) | ((abs / 2 ** exponent - 1) * 1024);
}

/**
 * A number of one of SurrealDB 4.0's fixed-width kinds: `i8`, `u8`, `i16`, `u16`, `i32`,
 * `u32` and `u64`, and the floats `f16` and `f32`.
 *
 * A connection which speaks `cbor.2` reads values of these kinds as instances of the
 * subclasses, and sends instances of them tagged, so that the server stores them with their
 * width. Over plain `cbor`, which servers before 4.0 speak, the server sends them widened, as
 * plain numbers, and the SDK sends instances widened in the same way: integers as integers (a
 * `u64` above the signed 64-bit range as a {@link Decimal}) and floats as floats.
 *
 * Each instance converts to its number with `valueOf()`, so arithmetic and comparisons with
 * plain numbers work on it (a `U64` to a `bigint`).
 */
export abstract class SizedNumber<T extends number | bigint = number | bigint> extends Value {
    static override [Symbol.hasInstance](instance: unknown): boolean {
        return hasSymbol(instance, SIZED_NUMBER_SYMBOL);
    }

    /**
     * The value, which the kind holds exactly
     */
    readonly value: T;

    protected constructor(value: T) {
        super();
        this.value = value;
        markSymbol(this, SIZED_NUMBER_SYMBOL);
    }

    /**
     * The kind of number, as SurrealQL spells it
     */
    abstract get kind(): SizedNumberKind;

    /**
     * Equal to a number of the same kind and value. NaN equals NaN, and -0 differs from 0.
     */
    equals(other: unknown): boolean {
        return (
            other instanceof SizedNumber &&
            other.kind === this.kind &&
            Object.is(other.value, this.value)
        );
    }

    override valueOf(): T {
        return this.value;
    }

    toJSON(): unknown {
        if (Value._useExperimentalToJson) {
            return JsonCodec.DEFAULT.encode(this);
        }
        return typeof this.value === "bigint" ? this.value.toString() : this.value;
    }

    toString(): string {
        return Object.is(this.value, -0) ? "-0" : String(this.value);
    }
}

/**
 * Whether a value is a sized number of the given kind.
 */
function isKind(instance: unknown, kind: SizedNumberKind): boolean {
    return hasSymbol(instance, SIZED_NUMBER_SYMBOL) && (instance as SizedNumber).kind === kind;
}

/** A SurrealDB `i8`: an integer from -128 to 127. */
export class I8 extends SizedNumber<number> {
    static override [Symbol.hasInstance](instance: unknown): boolean {
        return isKind(instance, "i8");
    }

    constructor(value: number | bigint) {
        super(Number(checkInteger("i8", value)));
    }

    get kind(): "i8" {
        return "i8";
    }
}

/** A SurrealDB `u8`: an integer from 0 to 255. */
export class U8 extends SizedNumber<number> {
    static override [Symbol.hasInstance](instance: unknown): boolean {
        return isKind(instance, "u8");
    }

    constructor(value: number | bigint) {
        super(Number(checkInteger("u8", value)));
    }

    get kind(): "u8" {
        return "u8";
    }
}

/** A SurrealDB `i16`: an integer from -32768 to 32767. */
export class I16 extends SizedNumber<number> {
    static override [Symbol.hasInstance](instance: unknown): boolean {
        return isKind(instance, "i16");
    }

    constructor(value: number | bigint) {
        super(Number(checkInteger("i16", value)));
    }

    get kind(): "i16" {
        return "i16";
    }
}

/** A SurrealDB `u16`: an integer from 0 to 65535. */
export class U16 extends SizedNumber<number> {
    static override [Symbol.hasInstance](instance: unknown): boolean {
        return isKind(instance, "u16");
    }

    constructor(value: number | bigint) {
        super(Number(checkInteger("u16", value)));
    }

    get kind(): "u16" {
        return "u16";
    }
}

/** A SurrealDB `i32`: an integer from -2147483648 to 2147483647. */
export class I32 extends SizedNumber<number> {
    static override [Symbol.hasInstance](instance: unknown): boolean {
        return isKind(instance, "i32");
    }

    constructor(value: number | bigint) {
        super(Number(checkInteger("i32", value)));
    }

    get kind(): "i32" {
        return "i32";
    }
}

/** A SurrealDB `u32`: an integer from 0 to 4294967295. */
export class U32 extends SizedNumber<number> {
    static override [Symbol.hasInstance](instance: unknown): boolean {
        return isKind(instance, "u32");
    }

    constructor(value: number | bigint) {
        super(Number(checkInteger("u32", value)));
    }

    get kind(): "u32" {
        return "u32";
    }
}

/**
 * A SurrealDB `u64`: an integer from 0 to 18446744073709551615, held as a `bigint`. It is the
 * only integer kind which goes past the signed 64-bit range of a plain SurrealDB `int`.
 */
export class U64 extends SizedNumber<bigint> {
    static override [Symbol.hasInstance](instance: unknown): boolean {
        return isKind(instance, "u64");
    }

    constructor(value: number | bigint) {
        super(checkInteger("u64", value));
    }

    get kind(): "u64" {
        return "u64";
    }
}

/**
 * A SurrealDB `f16`: an IEEE 754 half-precision float. The value is rounded to the nearest
 * half when the instance is made, as a cast does, so `new F16(0.1).value` is `0.0999755859375`.
 */
export class F16 extends SizedNumber<number> {
    static override [Symbol.hasInstance](instance: unknown): boolean {
        return isKind(instance, "f16");
    }

    constructor(value: number) {
        if (typeof value !== "number") throw new InvalidNumberError("An f16 is made from a number");
        super(f16round(value));
    }

    get kind(): "f16" {
        return "f16";
    }
}

/**
 * A SurrealDB `f32`: an IEEE 754 single-precision float. The value is rounded to the nearest
 * single when the instance is made, as a cast does, so `new F32(0.1).value` is
 * `0.10000000149011612`.
 */
export class F32 extends SizedNumber<number> {
    static override [Symbol.hasInstance](instance: unknown): boolean {
        return isKind(instance, "f32");
    }

    constructor(value: number) {
        if (typeof value !== "number") throw new InvalidNumberError("An f32 is made from a number");
        super(Math.fround(value));
    }

    get kind(): "f32" {
        return "f32";
    }
}
