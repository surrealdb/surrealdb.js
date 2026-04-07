import { JsonCodec } from "../codec/json/codec.ts";
import { InvalidDurationError } from "../errors.ts";
import { escapeRegex } from "../internal/escape-regex.ts";
import { DURATION_SYMBOL, hasSymbol, markSymbol } from "../utils/symbols.ts";
import { Value } from "./value.ts";

export type DurationTuple = [number | bigint, number | bigint] | [number | bigint] | [];

const NANOSECOND = 1n;
const MICROSECOND = 1000n * NANOSECOND;
const MILLISECOND = 1000n * MICROSECOND;
const SECOND = 1000n * MILLISECOND;
const MINUTE = 60n * SECOND;
const HOUR = 60n * MINUTE;
const DAY = 24n * HOUR;
const WEEK = 7n * DAY;
const YEAR = 365n * DAY;

const UNITS = new Map([
    ["ns", NANOSECOND],
    ["\u00b5s", MICROSECOND],
    ["\u03bcs", MICROSECOND],
    ["us", MICROSECOND],
    ["ms", MILLISECOND],
    ["s", SECOND],
    ["m", MINUTE],
    ["h", HOUR],
    ["d", DAY],
    ["w", WEEK],
    ["y", YEAR],
]);

const UNITS_REVERSED = Array.from(UNITS).reduce((map, [unit, size]) => {
    map.set(size, unit);
    return map;
}, new Map<bigint, string>());

const DURATION_PART_REGEX = new RegExp(
    `^(\\d+)\\.?\\d*(${Array.from(UNITS.keys()).map(escapeRegex).join("|")})`,
);

const FLOAT_DURATION_REGEX = new RegExp(
    `^(\\d+(?:\\.\\d+)?)(${Array.from(UNITS.keys()).map(escapeRegex).join("|")})$`,
);

/**
 * A SurrealQL duration value with support for parsing, formatting, arithmetic, and nanosecond precision.
 */
export class Duration extends Value {
    static override [Symbol.hasInstance](instance: unknown): boolean {
        return hasSymbol(instance, DURATION_SYMBOL);
    }

    readonly #seconds: bigint;
    readonly #nanoseconds: bigint;

    constructor(input: Duration);
    constructor(input: DurationTuple);
    constructor(input: string);

    // Shadow implementation
    constructor(input: Duration | DurationTuple | string) {
        super();

        if (input instanceof Duration) {
            this.#seconds = input.#seconds;
            this.#nanoseconds = input.#nanoseconds;
        } else if (typeof input === "string") {
            const [s, ns] = Duration.parseString(input);
            this.#seconds = s;
            this.#nanoseconds = ns;
        } else {
            const s = typeof input[0] === "bigint" ? input[0] : BigInt(Math.floor(input[0] ?? 0));
            const ns = typeof input[1] === "bigint" ? input[1] : BigInt(Math.floor(input[1] ?? 0));
            const total = s * SECOND + ns;
            this.#seconds = total / SECOND;
            this.#nanoseconds = total % SECOND;
        }
        markSymbol(this, DURATION_SYMBOL);
    }

    equals(other: unknown): boolean {
        if (!(other instanceof Duration)) return false;
        return this.#seconds === other.#seconds && this.#nanoseconds === other.#nanoseconds;
    }

    toJSON(): unknown {
        if (Value._useExperimentalToJson) {
            return JsonCodec.DEFAULT.encode(this);
        }
        return this.toString();
    }

    toString(): string {
        let remainingSeconds = this.#seconds;
        let result = "";

        for (const [size, unit] of Array.from(UNITS_REVERSED).reverse()) {
            if (size >= SECOND) {
                const amount = remainingSeconds / (size / SECOND);
                if (amount > 0n) {
                    remainingSeconds %= size / SECOND;
                    result += `${amount}${unit}`;
                }
            }
        }

        let remainingNanoseconds = remainingSeconds * SECOND + this.#nanoseconds;

        for (const [size, unit] of Array.from(UNITS_REVERSED).reverse()) {
            if (size < SECOND) {
                const amount = remainingNanoseconds / size;
                if (amount > 0n) {
                    remainingNanoseconds %= size;
                    result += `${amount}${unit}`;
                }
            }
        }

        return result;
    }

    toCompact(): [bigint, bigint] | [bigint] | [] {
        return this.#nanoseconds > 0n
            ? [this.#seconds, this.#nanoseconds]
            : this.#seconds > 0n
              ? [this.#seconds]
              : [];
    }

    static parseString(input: string): [bigint, bigint] {
        let seconds = 0n;
        let nanoseconds = 0n;
        let left = input;

        while (left !== "") {
            const match = left.match(DURATION_PART_REGEX);
            if (match) {
                const amount = BigInt(match[1]);
                const unit = match[2];
                const factor = UNITS.get(unit);
                if (!factor) throw new InvalidDurationError(`Invalid duration unit: ${unit}`);

                if (factor >= SECOND) {
                    seconds += amount * (factor / SECOND);
                } else {
                    nanoseconds += amount * factor;
                }

                left = left.slice(match[0].length);
            } else {
                throw new InvalidDurationError("Could not match a next duration part");
            }
        }

        seconds += nanoseconds / SECOND;
        nanoseconds %= SECOND;
        return [seconds, nanoseconds];
    }

    add(other: Duration): Duration {
        let sec = this.#seconds + other.#seconds;
        let ns = this.#nanoseconds + other.#nanoseconds;
        if (ns >= SECOND) {
            sec += 1n;
            ns -= SECOND;
        }
        return new Duration([sec, ns]);
    }

    sub(other: Duration): Duration {
        let sec = this.#seconds - other.#seconds;
        let ns = this.#nanoseconds - other.#nanoseconds;
        if (ns < 0n) {
            sec -= 1n;
            ns += SECOND;
        }
        return new Duration([sec, ns]);
    }

    mul(factor: number | bigint): Duration {
        const factorBig = typeof factor === "bigint" ? factor : BigInt(Math.floor(factor));
        const totalNs = this.#seconds * SECOND + this.#nanoseconds;
        const resultNs = totalNs * factorBig;
        return new Duration([resultNs / SECOND, resultNs % SECOND]);
    }

    div(divisor: Duration): bigint;
    div(divisor: number | bigint): Duration;
    div(divisor: number | bigint | Duration): bigint | Duration {
        if (typeof divisor === "object" && divisor instanceof Duration) {
            const a = this.#seconds * SECOND + this.#nanoseconds;
            const b = divisor.#seconds * SECOND + divisor.#nanoseconds;
            if (b === 0n) throw new InvalidDurationError("Division by zero duration");
            return a / b;
        }
        const divisorBig = typeof divisor === "bigint" ? divisor : BigInt(Math.floor(divisor));
        if (divisorBig === 0n) throw new InvalidDurationError("Division by zero");
        const totalNs = this.#seconds * SECOND + this.#nanoseconds;
        const resultNs = totalNs / divisorBig;
        return new Duration([resultNs / SECOND, resultNs % SECOND]);
    }

    mod(mod: Duration): Duration {
        const a = this.#seconds * SECOND + this.#nanoseconds;
        const b = mod.#seconds * SECOND + mod.#nanoseconds;
        if (b === 0n) throw new InvalidDurationError("Modulo by zero duration");
        const resultNs = a % b;
        return new Duration([resultNs / SECOND, resultNs % SECOND]);
    }

    get nanoseconds(): bigint {
        return this.#seconds * SECOND + this.#nanoseconds;
    }

    get microseconds(): bigint {
        return this.nanoseconds / MICROSECOND;
    }

    get milliseconds(): bigint {
        return this.nanoseconds / MILLISECOND;
    }

    get seconds(): bigint {
        return this.#seconds;
    }

    get minutes(): bigint {
        return this.#seconds / (MINUTE / SECOND);
    }

    get hours(): bigint {
        return this.#seconds / (HOUR / SECOND);
    }

    get days(): bigint {
        return this.#seconds / (DAY / SECOND);
    }

    get weeks(): bigint {
        return this.#seconds / (WEEK / SECOND);
    }

    get years(): bigint {
        return this.#seconds / (YEAR / SECOND);
    }

    static nanoseconds(ns: number | bigint): Duration {
        const n = typeof ns === "bigint" ? ns : BigInt(Math.floor(ns));
        return new Duration([n / SECOND, n % SECOND]);
    }

    static microseconds(µs: number | bigint): Duration {
        const n = typeof µs === "bigint" ? µs : BigInt(Math.floor(µs));
        return Duration.nanoseconds(n * MICROSECOND);
    }

    static milliseconds(ms: number | bigint): Duration {
        const n = typeof ms === "bigint" ? ms : BigInt(Math.floor(ms));
        return Duration.nanoseconds(n * MILLISECOND);
    }

    static seconds(s: number | bigint): Duration {
        const n = typeof s === "bigint" ? s : BigInt(Math.floor(s));
        return new Duration([n, 0n]);
    }

    static minutes(m: number | bigint): Duration {
        const n = typeof m === "bigint" ? m : BigInt(Math.floor(m));
        return new Duration([n * (MINUTE / SECOND), 0n]);
    }

    static hours(h: number | bigint): Duration {
        const n = typeof h === "bigint" ? h : BigInt(Math.floor(h));
        return new Duration([n * (HOUR / SECOND), 0n]);
    }

    static days(d: number | bigint): Duration {
        const n = typeof d === "bigint" ? d : BigInt(Math.floor(d));
        return new Duration([n * (DAY / SECOND), 0n]);
    }

    static weeks(w: number | bigint): Duration {
        const n = typeof w === "bigint" ? w : BigInt(Math.floor(w));
        return new Duration([n * (WEEK / SECOND), 0n]);
    }

    static years(y: number | bigint): Duration {
        const n = typeof y === "bigint" ? y : BigInt(Math.floor(y));
        return new Duration([n * (YEAR / SECOND), 0n]);
    }

    static parseFloat(input: string): Duration {
        const match = input.match(FLOAT_DURATION_REGEX);

        if (!match) {
            throw new InvalidDurationError(`Invalid float duration string: ${input}`);
        }

        const numStr = match[1];
        const unit = match[2];
        const factor = UNITS.get(unit);

        if (!factor) throw new InvalidDurationError(`Invalid duration unit: ${unit}`);

        const [intPart, fracPart = ""] = numStr.split(".");
        const scale = 10n ** BigInt(fracPart.length);
        const scaledValue = BigInt(intPart) * scale + BigInt(fracPart || "0");
        const totalNs = (scaledValue * factor) / scale;

        return new Duration([totalNs / SECOND, totalNs % SECOND]);
    }

    static measure(): () => Duration {
        if (typeof performance !== "undefined" && performance.now) {
            const start = performance.now();
            return () => {
                const end = performance.now();
                return Duration.nanoseconds((end - start) * 1000000);
            };
        }

        const start = Date.now();
        return () => {
            const end = Date.now();
            return Duration.milliseconds(end - start);
        };
    }
}
