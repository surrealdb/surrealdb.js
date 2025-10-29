import { InvalidDateError, SurrealError } from "../errors";
import { Duration } from "./duration";
import { Value } from "./value";

// Time unit definitions in nanoseconds
const NANOSECOND = 1n;
const MICROSECOND = 1000n * NANOSECOND;
const MILLISECOND = 1000n * MICROSECOND;
const SECOND = 1000n * MILLISECOND;

export type DateTimeTuple = [number | bigint, number | bigint];

/**
 * A SurrealQL datetime value with support for parsing, formatting, arithmetic, and nanosecond precision.
 */
export class DateTime extends Value {
    readonly #seconds: bigint;
    readonly #nanoseconds: bigint;

    private static loadHr =
        typeof process !== "undefined" && process.hrtime
            ? {
                  ns: process.hrtime.bigint(),
                  ms: BigInt(Date.now()),
              }
            : undefined;

    /**
     * Constructs a new DateTime with the current time, equivalent to `DateTime.now()`
     */
    constructor();

    /**
     * Constructs a new DateTime by cloning an existing datetime
     *
     * @param input DateTime input
     */
    constructor(input: DateTime);

    /**
     * Constructs a new DateTime from a JavaScript Date object
     *
     * @param input Date input
     */
    constructor(input: Date);

    /**
     * Constructs a new DateTime from a tuple representation
     *
     * @param input Second and nanosecond tuple
     */
    constructor(input: DateTimeTuple);

    /**
     * Constructs a new DateTime from an ISO String
     *
     * @param input ISO String string
     */
    constructor(input: string);

    /**
     * Constructs a new DateTime from a number or bigint
     *
     * @param input Number or bigint input
     */
    constructor(input: number | bigint);

    // Shadow implementation
    constructor(input?: DateTime | Date | DateTimeTuple | string | number | bigint) {
        super();

        if (input === undefined) {
            const now = DateTime.now();
            this.#seconds = now.#seconds;
            this.#nanoseconds = now.#nanoseconds;
        } else if (input instanceof DateTime) {
            // Clone from existing datetime
            this.#seconds = input.#seconds;
            this.#nanoseconds = input.#nanoseconds;
        } else if (input instanceof Date) {
            // Convert from JavaScript Date
            const time = input.getTime();
            if (Number.isNaN(time)) {
                throw new InvalidDateError(input);
            }
            const s = BigInt(Math.floor(time / 1000));
            const ns = BigInt((time % 1000) * 1000000);
            this.#seconds = s;
            this.#nanoseconds = ns;
        } else if (typeof input === "string") {
            // Parse from ISO string or other datetime format
            const [s, ns] = DateTime.parseString(input);
            this.#seconds = s;
            this.#nanoseconds = ns;
        } else if (typeof input === "number") {
            // Convert from Unix timestamp (seconds since epoch)
            this.#seconds = BigInt(Math.floor(input));
            this.#nanoseconds = 0n;
        } else if (typeof input === "bigint") {
            // Convert from Unix timestamp (seconds since epoch)
            this.#seconds = input;
            this.#nanoseconds = 0n;
        } else {
            // Construct from tuple [seconds, nanoseconds]
            const s = typeof input[0] === "bigint" ? input[0] : BigInt(Math.floor(input[0] ?? 0));
            const ns = typeof input[1] === "bigint" ? input[1] : BigInt(Math.floor(input[1] ?? 0));

            // Normalize nanoseconds to be within [0, 1 second)
            const totalSeconds = s + ns / SECOND;
            this.#seconds = totalSeconds;
            this.#nanoseconds = ns % SECOND;
        }
    }

    equals(other: unknown): boolean {
        if (!(other instanceof DateTime)) return false;
        return this.#seconds === other.#seconds && this.#nanoseconds === other.#nanoseconds;
    }

    toJSON(): string {
        return this.toISOString();
    }

    /**
     * @returns The ISO 8601 string representation of the datetime
     */
    toString(): string {
        return this.toISOString();
    }

    /**
     * Converts the datetime to a tuple
     */
    toCompact(): [bigint, bigint] {
        return [this.#seconds, this.#nanoseconds];
    }

    /**
     * Formats the datetime as an ISO 8601 string
     */
    toISOString(): string {
        // Calculate total milliseconds including nanosecond precision
        const totalMilliseconds =
            Number(this.#seconds) * 1000 + Number(this.#nanoseconds) / 1000000;
        const date = new Date(totalMilliseconds);
        const isoString = date.toISOString();

        if (this.#nanoseconds === 0n) {
            return isoString;
        }

        // Format nanoseconds as a single fractional part (up to 9 digits)
        const nanoseconds = this.#nanoseconds.toString().padStart(9, "0");
        // Remove trailing zeros
        const trimmed = nanoseconds.replace(/0+$/, "");

        // Replace the milliseconds part with the full nanosecond precision
        return isoString.replace(/\.\d{3}Z$/, `.${trimmed}Z`);
    }

    /**
     * Converts to JavaScript Date object
     */
    toDate(): Date {
        const milliseconds =
            Number(this.#seconds) * 1000 + Math.floor(Number(this.#nanoseconds) / 1000000);
        return new Date(milliseconds);
    }

    /**
     * Parses a datetime string
     *
     * @param input Input string (ISO 8601 format)
     * @returns [seconds, nanoseconds] tuple
     */
    static parseString(input: string): [bigint, bigint] {
        // Handle ISO 8601 format: YYYY-MM-DDTHH:mm:ss.sssZ
        const isoRegex = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?Z?$/;
        const match = input.match(isoRegex);

        if (match) {
            const [, year, month, day, hour, minute, second, fraction] = match;

            // Parse the base time without fraction first
            const baseIsoString = `${year}-${month}-${day}T${hour}:${minute}:${second}Z`;
            const baseDate = new Date(baseIsoString);
            const baseTimestamp = baseDate.getTime();

            if (Number.isNaN(baseTimestamp)) {
                throw new InvalidDateError(baseDate);
            }

            const seconds = BigInt(Math.floor(baseTimestamp / 1000));
            let nanoseconds = 0n;

            if (fraction) {
                // Convert fraction to nanoseconds based on its length
                const fractionLength = fraction.length;
                if (fractionLength <= 3) {
                    // Milliseconds: convert to nanoseconds
                    nanoseconds = BigInt(fraction.padEnd(3, "0")) * 1000000n;
                } else if (fractionLength <= 6) {
                    // Microseconds: convert to nanoseconds
                    nanoseconds = BigInt(fraction.padEnd(6, "0")) * 1000n;
                } else {
                    // Already nanoseconds: pad to 9 digits
                    nanoseconds = BigInt(fraction.padEnd(9, "0"));
                }
            }

            return [seconds, nanoseconds];
        }

        // Try parsing as Unix timestamp
        const timestamp = Date.parse(input);

        if (!Number.isNaN(timestamp)) {
            const seconds = BigInt(Math.floor(timestamp / 1000));
            const nanoseconds = BigInt((timestamp % 1000) * 1000000);
            return [seconds, nanoseconds];
        }

        throw new SurrealError(`Invalid datetime format: ${input}`);
    }

    /**
     * Adds a duration to this datetime
     *
     * @param duration The duration to add
     * @returns The new datetime instance
     */
    add(duration: Duration): DateTime {
        const [durSeconds, durNanoseconds] = duration.toCompact();
        let newSeconds = this.#seconds + (durSeconds || 0n);
        let newNanoseconds = this.#nanoseconds + (durNanoseconds || 0n);

        if (newNanoseconds >= SECOND) {
            newSeconds += 1n;
            newNanoseconds -= SECOND;
        }

        return new DateTime([newSeconds, newNanoseconds]);
    }

    /**
     * Subtracts a duration from this datetime
     *
     * @param duration The duration to subtract
     * @returns The new datetime instance
     */
    sub(duration: Duration): DateTime {
        const [durSeconds, durNanoseconds] = duration.toCompact();
        let newSeconds = this.#seconds - (durSeconds || 0n);
        let newNanoseconds = this.#nanoseconds - (durNanoseconds || 0n);

        if (newNanoseconds < 0n) {
            newSeconds -= 1n;
            newNanoseconds += SECOND;
        }

        return new DateTime([newSeconds, newNanoseconds]);
    }

    /**
     * Calculates the duration between two datetimes
     *
     * @param other The other datetime
     */
    diff(other: DateTime): Duration {
        const totalThis = this.#seconds * SECOND + this.#nanoseconds;
        const totalOther = other.#seconds * SECOND + other.#nanoseconds;
        const diff = totalThis > totalOther ? totalThis - totalOther : totalOther - totalThis;

        return Duration.nanoseconds(diff);
    }

    /**
     * Compares this DateTime with another
     *
     * @param other The DateTime to compare with
     * @returns -1 if other is before, 0 if equal, 1 if other is after
     */
    compare(other: DateTime): number {
        const a = this.nanoseconds;
        const b = other.nanoseconds;
        if (a < b) return -1;
        if (a > b) return 1;
        return 0;
    }

    /**
     * Total nanoseconds since Unix epoch
     */
    get nanoseconds(): bigint {
        return this.#seconds * SECOND + this.#nanoseconds;
    }

    /**
     * Total microseconds since Unix epoch
     */
    get microseconds(): bigint {
        return this.nanoseconds / MICROSECOND;
    }

    /**
     * Total milliseconds since Unix epoch
     */
    get milliseconds(): number {
        return Number(this.nanoseconds / MILLISECOND);
    }

    /**
     * Seconds since Unix epoch
     */
    get seconds(): number {
        return Number(this.#seconds);
    }

    /**
     * Creates a DateTime from nanoseconds since Unix epoch
     *
     * @param ns Nanoseconds value
     */
    static fromEpochNanoseconds(ns: number | bigint): DateTime {
        const n = typeof ns === "bigint" ? ns : BigInt(Math.floor(ns));
        return new DateTime([n / SECOND, n % SECOND]);
    }

    /**
     * Creates a DateTime from microseconds since Unix epoch
     *
     * @param µs Microseconds value
     */
    static fromEpochMicroseconds(µs: number | bigint): DateTime {
        const n = typeof µs === "bigint" ? µs : BigInt(Math.floor(µs));
        return DateTime.fromEpochNanoseconds(n * MICROSECOND);
    }

    /**
     * Creates a DateTime from milliseconds since Unix epoch
     *
     * @param ms Milliseconds value
     */
    static fromEpochMilliseconds(ms: number | bigint): DateTime {
        const n = typeof ms === "bigint" ? ms : BigInt(Math.floor(ms));
        return DateTime.fromEpochNanoseconds(n * MILLISECOND);
    }

    /**
     * Creates a DateTime from seconds since Unix epoch
     *
     * @param s Seconds value
     */
    static fromEpochSeconds(s: number | bigint): DateTime {
        const n = typeof s === "bigint" ? s : BigInt(Math.floor(s));
        return new DateTime([n, 0n]);
    }

    /**
     * Returns a new DateTime representing the current time
     */
    static now(): DateTime {
        // Use process.hrtime() for nanosecond precision if available (Node.js)
        if (DateTime.loadHr) {
            const diffNs = process.hrtime.bigint() - DateTime.loadHr.ns;
            const totalNanoseconds = DateTime.loadHr.ms * 1000000n + diffNs;
            const seconds = totalNanoseconds / 1000000000n;
            const nanoseconds = totalNanoseconds % 1000000000n;
            return new DateTime([seconds, nanoseconds]);
        }

        // Use high-precision timing if the Performance API is available
        if (typeof performance !== "undefined" && performance.now && performance.timeOrigin) {
            const totalMilliseconds = performance.timeOrigin + performance.now();
            const seconds = BigInt(Math.floor(totalMilliseconds / 1000));
            // performance.now() returns microseconds as float, so multiply by 1000 to get nanoseconds
            const nanoseconds = BigInt(Math.floor((totalMilliseconds % 1000) * 1000000));
            return new DateTime([seconds, nanoseconds]);
        }

        // Fallback to standard Date.now()
        const now = Date.now();
        const seconds = BigInt(Math.floor(now / 1000));
        const nanoseconds = BigInt((now % 1000) * 1000000);

        return new DateTime([seconds, nanoseconds]);
    }

    /**
     * Returns a new DateTime representing the Unix epoch (1970-01-01T00:00:00Z)
     */
    static epoch(): DateTime {
        return new DateTime([0n, 0n]);
    }
}
