import { InvalidDurationError } from "../errors";
import { escapeRegex } from "../internal/escape-regex";
import { DURATION_SYMBOL, isDuration, markSymbol } from "../utils/symbols";
import { Value } from "./value";

export type DurationTuple = [number | bigint, number | bigint] | [number | bigint] | [];

// Time unit definitions in nanoseconds
const NANOSECOND = 1n;
const MICROSECOND = 1000n * NANOSECOND;
const MILLISECOND = 1000n * MICROSECOND;
const SECOND = 1000n * MILLISECOND;
const MINUTE = 60n * SECOND;
const HOUR = 60n * MINUTE;
const DAY = 24n * HOUR;
const WEEK = 7n * DAY;
const YEAR = 365n * DAY;

// Unit string to nanosecond mapping
const UNITS = new Map([
    ["ns", NANOSECOND],
    ["\u00b5s", MICROSECOND], // micro (Greek letter mu)
    ["\u03bcs", MICROSECOND], // micro (Greek letter mu variant)
    ["us", MICROSECOND], // ASCII fallback
    ["ms", MILLISECOND],
    ["s", SECOND],
    ["m", MINUTE],
    ["h", HOUR],
    ["d", DAY],
    ["w", WEEK],
    ["y", YEAR],
]);

// Reversed mapping of nanoseconds to unit string
const UNITS_REVERSED = Array.from(UNITS).reduce((map, [unit, size]) => {
    map.set(size, unit);
    return map;
}, new Map<bigint, string>());

// Regex for parsing duration parts like "3h" or "15ms"
const DURATION_PART_REGEX = new RegExp(
    `^(\\d+)\\.?\\d*(${Array.from(UNITS.keys()).map(escapeRegex).join("|")})`,
);

// Regex for parsing a single float duration like "1.5s" or "500.0ms"
const FLOAT_DURATION_REGEX = new RegExp(
    `^(\\d+(?:\\.\\d+)?)(${Array.from(UNITS.keys()).map(escapeRegex).join("|")})$`,
);

/**
 * A SurrealQL duration value with support for parsing, formatting, arithmetic, and nanosecond precision.
 */
export class Duration extends Value {
    readonly _seconds: bigint;
    readonly _ns: bigint;

    /**
     * Constructs a new Duration by cloning an existing duration
     *
     * @param input Duration input
     */
    constructor(input: Duration);

    /**
     * Constructs a new Duration from a tuple representation
     *
     * @param input Second and nanosecond tuple
     */
    constructor(input: DurationTuple);

    /**
     * Constructs a new Duration from a human-readable string, e.g. "1h30m"
     *
     * @param input Duration string
     */
    constructor(input: string);

    // Shadow implementation
    constructor(input?: Duration | DurationTuple | string | number | bigint) {
        super();

        if (input === undefined) {
            this._seconds = 0n;
            this._ns = 0n;
        } else if (isDuration(input)) {
            // Clone from existing duration (uses public getter for cross-version compatibility)
            const totalNs = (input as unknown as Duration).nanoseconds;
            this._seconds = totalNs / SECOND;
            this._ns = totalNs % SECOND;
        } else if (typeof input === "string") {
            // Parse from a human-readable string like "1h30m"
            const [s, ns] = Duration.parseString(input);
            this._seconds = s;
            this._ns = ns;
        } else if (typeof input === "number" || typeof input === "bigint") {
            const total = BigInt(input);
            this._seconds = total / SECOND;
            this._ns = total % SECOND;
        } else if (Array.isArray(input)) {
            const [seconds, nanoseconds] = input;
            const s = typeof seconds === "bigint" ? seconds : BigInt(Math.floor(seconds ?? 0));
            const ns =
                typeof nanoseconds === "bigint"
                    ? nanoseconds
                    : BigInt(Math.floor(nanoseconds ?? 0));
            const total = s * SECOND + ns;
            // Normalize total into separate seconds and nanoseconds fields
            this._seconds = total / SECOND;
            this._ns = total % SECOND;
        } else {
            this._seconds = 0n;
            this._ns = 0n;
        }
        markSymbol(this, DURATION_SYMBOL);
    }

    equals(other: unknown): boolean {
        if (!isDuration(other)) return false;
        return this.nanoseconds === (other as unknown as Duration).nanoseconds;
    }

    toJSON(): string {
        return this.toString();
    }

    /**
     * @returns Human readable duration string
     */
    toString(): string {
        let remainingSeconds = this._seconds;
        let result = "";

        // Convert seconds into largest possible whole units (≥ 1s)
        for (const [size, unit] of Array.from(UNITS_REVERSED).reverse()) {
            if (size >= SECOND) {
                const amount = remainingSeconds / (size / SECOND);
                if (amount > 0n) {
                    remainingSeconds %= size / SECOND;
                    result += `${amount}${unit}`;
                }
            }
        }

        // Convert remaining seconds to nanoseconds
        let remainingNanoseconds = remainingSeconds * SECOND + this._ns;

        // Convert sub-second nanoseconds to units < 1s
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

    /**
     * Converts the duration to a tuple
     */
    toCompact(): [bigint, bigint] | [bigint] | [] {
        return this._ns > 0n
            ? [this._seconds, this._ns]
            : this._seconds > 0n
                ? [this._seconds]
                : [];
    }

    /**
     * Parses a duration string like "1h30m"
     *
     * @param input Input string
     * @returns [seconds, nanoseconds]
     */
    static parseString(input: string): [bigint, bigint] {
        let seconds = 0n;
        let nanoseconds = 0n;
        let left = input;

        // Loop through string and extract valid duration parts
        while (left !== "") {
            const match = left.match(DURATION_PART_REGEX);
            if (match) {
                const amount = BigInt(match[1]);
                const unit = match[2];
                const factor = UNITS.get(unit);
                if (!factor) throw new InvalidDurationError(`Invalid duration unit: ${unit}`);

                if (factor >= SECOND) {
                    // Accumulate seconds
                    seconds += amount * (factor / SECOND);
                } else {
                    // Accumulate nanoseconds
                    nanoseconds += amount * factor;
                }

                // Slice the processed segment off
                left = left.slice(match[0].length);
            } else {
                throw new InvalidDurationError("Could not match a next duration part");
            }
        }

        // Normalize: convert overflow nanoseconds to seconds
        seconds += nanoseconds / SECOND;
        nanoseconds %= SECOND;
        return [seconds, nanoseconds];
    }

    /**
     * Adds two durations together
     *
     * @param other The duration to add
     * @returns The resulting duration
     */
    add(other: Duration): Duration {
        const totalNs = this.nanoseconds + (other as unknown as Duration).nanoseconds;
        return new Duration([totalNs / SECOND, totalNs % SECOND]);
    }

    /**
     * Subtracts another duration from this one
     *
     * @param other The duration to subtract
     * @returns The resulting duration
     */
    sub(other: Duration): Duration {
        const totalNs = this.nanoseconds - (other as unknown as Duration).nanoseconds;
        return new Duration([totalNs / SECOND, totalNs % SECOND]);
    }

    /**
     * Multiplies the duration by a scalar
     *
     * @param factor The factor to multiply by
     * @returns The resulting duration
     */
    mul(factor: number | bigint): Duration {
        const factorBig = typeof factor === "bigint" ? factor : BigInt(Math.floor(factor));
        const totalNs = this._seconds * SECOND + this._ns;
        const resultNs = totalNs * factorBig;
        return new Duration([resultNs / SECOND, resultNs % SECOND]);
    }

    /**
     * Divides the duration
     *
     * @param divisor The duration or scalar to divide by
     * @returns A new Duration or ratio (unitless bigint)
     */
    div(divisor: Duration): bigint;
    div(divisor: number | bigint): Duration;
    div(divisor: number | bigint | Duration): bigint | Duration {
        if (typeof divisor === "object" && isDuration(divisor)) {
            const a = this.nanoseconds;
            const b = (divisor as unknown as Duration).nanoseconds;
            if (b === 0n) throw new InvalidDurationError("Division by zero duration");
            return a / b;
        }
        const divisorBig =
            typeof divisor === "bigint" ? divisor : BigInt(Math.floor(divisor as number));
        if (divisorBig === 0n) throw new InvalidDurationError("Division by zero");
        const totalNs = this._seconds * SECOND + this._ns;
        const resultNs = totalNs / divisorBig;
        return new Duration([resultNs / SECOND, resultNs % SECOND]);
    }

    /**
     * Computes the remainder after division
     *
     * @param mod The divisor
     * @returns The remainder duration
     */
    mod(mod: Duration): Duration {
        const a = this.nanoseconds;
        const b = (mod as unknown as Duration).nanoseconds;
        if (b === 0n) throw new InvalidDurationError("Modulo by zero duration");
        const resultNs = a % b;
        return new Duration([resultNs / SECOND, resultNs % SECOND]);
    }

    /**
     * Total nanoseconds in this duration
     */
    get nanoseconds(): bigint {
        return this._seconds * SECOND + this._ns;
    }

    /**
     * Total microseconds
     */
    get microseconds(): bigint {
        return this.nanoseconds / MICROSECOND;
    }

    /**
     * Total milliseconds
     */
    get milliseconds(): bigint {
        return this.nanoseconds / MILLISECOND;
    }

    /**
     * Whole seconds in the duration
     */
    get seconds(): bigint {
        return this._seconds;
    }

    /**
     * Total whole minutes in the duration
     */
    get minutes(): bigint {
        return this._seconds / (MINUTE / SECOND);
    }

    /**
     * Total whole hours in the duration
     */
    get hours(): bigint {
        return this._seconds / (HOUR / SECOND);
    }

    /**
     * Total whole days in the duration
     */
    get days(): bigint {
        return this._seconds / (DAY / SECOND);
    }

    /**
     * Total whole weeks in the duration
     */
    get weeks(): bigint {
        return this._seconds / (WEEK / SECOND);
    }

    /**
     * Total whole years in the duration
     */
    get years(): bigint {
        return this._seconds / (YEAR / SECOND);
    }

    /**
     * Creates a Duration from nanoseconds
     *
     * @param ns Nanoseconds value
     * @returns The resulting duration
     */
    static nanoseconds(ns: number | bigint): Duration {
        const n = typeof ns === "bigint" ? ns : BigInt(Math.floor(ns));
        return new Duration([n / SECOND, n % SECOND]);
    }

    /**
     * Creates a Duration from microseconds
     *
     * @param µs Microseconds value
     * @returns The resulting duration
     */
    static microseconds(µs: number | bigint): Duration {
        const n = typeof µs === "bigint" ? µs : BigInt(Math.floor(µs));
        return Duration.nanoseconds(n * MICROSECOND);
    }

    /**
     * Creates a Duration from milliseconds
     *
     * @param ms Milliseconds value
     * @returns The resulting duration
     */
    static milliseconds(ms: number | bigint): Duration {
        const n = typeof ms === "bigint" ? ms : BigInt(Math.floor(ms));
        return Duration.nanoseconds(n * MILLISECOND);
    }

    /**
     * Creates a Duration from seconds
     *
     * @param s Seconds value
     * @returns The resulting duration
     */
    static seconds(s: number | bigint): Duration {
        const n = typeof s === "bigint" ? s : BigInt(Math.floor(s));
        return new Duration([n, 0n]);
    }

    /**
     * Creates a Duration from minutes
     *
     * @param m Minutes value
     * @returns The resulting duration
     */
    static minutes(m: number | bigint): Duration {
        const n = typeof m === "bigint" ? m : BigInt(Math.floor(m));
        return new Duration([n * (MINUTE / SECOND), 0n]);
    }

    /**
     * Creates a Duration from hours
     *
     * @param h Hours value
     * @returns The resulting duration
     */
    static hours(h: number | bigint): Duration {
        const n = typeof h === "bigint" ? h : BigInt(Math.floor(h));
        return new Duration([n * (HOUR / SECOND), 0n]);
    }

    /**
     * Creates a Duration from days
     *
     * @param d Days value
     * @returns The resulting duration
     */
    static days(d: number | bigint): Duration {
        const n = typeof d === "bigint" ? d : BigInt(Math.floor(d));
        return new Duration([n * (DAY / SECOND), 0n]);
    }

    /**
     * Creates a Duration from weeks
     *
     * @param w Weeks value
     * @returns The resulting duration
     */
    static weeks(w: number | bigint): Duration {
        const n = typeof w === "bigint" ? w : BigInt(Math.floor(w));
        return new Duration([n * (WEEK / SECOND), 0n]);
    }

    /**
     * Creates a Duration from years
     *
     * @param y Years value
     * @returns The resulting duration
     */
    static years(y: number | bigint): Duration {
        const n = typeof y === "bigint" ? y : BigInt(Math.floor(y));
        return new Duration([n * (YEAR / SECOND), 0n]);
    }

    /**
     * Parses a duration from a float string with a single time unit, e.g. "1.998487792s", "1.5m", "500.0ms"
     *
     * @param input Float duration string
     * @returns The resulting duration
     */
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

    /**
     * Measures the elapsed time since the function was called
     * If the Performance API is available, it uses it to measure the elapsed time in nanoseconds
     *
     * @returns A function that returns the elapsed time as a Duration
     */
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
