/**
 * SurrealQL DateTime class supporting nanosecond precision.
 * Represents a point in time, serializable and compatible with arithmetic operations.
 */
import { SurrealError } from "../errors";
import { Value } from "./value";
import { Duration } from "./duration";

// Time unit definitions in nanoseconds
const NANOSECOND = 1n;
const MICROSECOND = 1000n * NANOSECOND;
const MILLISECOND = 1000n * MICROSECOND;
const SECOND = 1000n * MILLISECOND;
const MINUTE = 60n * SECOND;
const HOUR = 60n * MINUTE;
const DAY = 24n * HOUR;



/**
 * A high-precision datetime class supporting parsing, formatting, and arithmetic.
 */
export class DateTime extends Value {
    readonly #seconds: bigint;
    readonly #nanoseconds: bigint;

    /**
     * Constructs a new DateTime.
     * @param {DateTime | Date | [number|bigint, number|bigint] | string | number} input - DateTime input (optional, defaults to current time)
     */
    constructor(input?: DateTime | Date | [number | bigint, number | bigint] | string | number | undefined) {
        super();

        if (input === undefined) {
            // Default to current time with high precision if available
            const [s, ns] = DateTime.#now();
            this.#seconds = s;
            this.#nanoseconds = ns;
        } else if (input instanceof DateTime) {
            // Clone from existing datetime
            this.#seconds = input.#seconds;
            this.#nanoseconds = input.#nanoseconds;
        } else if (input instanceof Date) {
            // Convert from JavaScript Date
            const s = BigInt(Math.floor(input.getTime() / 1000));
            const ns = BigInt((input.getTime() % 1000) * 1000000);
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

    /**
     * Creates a datetime from a compact array form.
     * @param {[number|bigint, number|bigint] | [number|bigint] | []} param0 - Tuple input
     * @returns {DateTime} New datetime
     */
    static fromCompact([s, ns]:
        | [number | bigint, number | bigint]
        | [number | bigint]
        | []): DateTime {
        return new DateTime([s ?? 0n, ns ?? 0n]);
    }

    /**
     * Compares two datetimes.
     * @param {unknown} other - Another value
     * @returns {boolean} True if equal
     */
    equals(other: unknown): boolean {
        if (!(other instanceof DateTime)) return false;
        return this.#seconds === other.#seconds && this.#nanoseconds === other.#nanoseconds;
    }

    /**
     * Converts the datetime to a tuple.
     * @returns {[bigint, bigint] | [bigint] | []} Compact form
     */
    toCompact(): [bigint, bigint] | [bigint] | [] {
        return this.#nanoseconds > 0n
            ? [this.#seconds, this.#nanoseconds]
            : this.#seconds > 0n
              ? [this.#seconds]
              : [];
    }

    /**
     * Formats the datetime as an ISO 8601 string.
     * @returns {string} ISO datetime string
     */
    toString(): string {
        return this.toISOString();
    }

    /**
     * Formats the datetime as an ISO 8601 string.
     * @returns {string} ISO datetime string
     */
    toISOString(): string {
        const date = new Date(Number(this.#seconds) * 1000);
        const isoString = date.toISOString();
        
        if (this.#nanoseconds === 0n) {
            return isoString;
        }
        
        // Add nanoseconds to the ISO string, but only show significant digits
        const nanoseconds = this.#nanoseconds.toString().padStart(9, '0');
        // Remove trailing zeros
        const trimmed = nanoseconds.replace(/0+$/, '');
        return isoString.replace('Z', `.${trimmed}Z`);
    }

    /**
     * Serializes datetime to a JSON string.
     * @returns {string}
     */
    toJSON(): string {
        return this.toISOString();
    }

    /**
     * Converts to JavaScript Date object.
     * @returns {Date} JavaScript Date
     */
    toDate(): Date {
        const milliseconds = Number(this.#seconds) * 1000 + Math.floor(Number(this.#nanoseconds) / 1000000);
        return new Date(milliseconds);
    }

    /**
     * Parses a datetime string.
     * @param {string} input - Input string (ISO 8601 format)
     * @returns {[bigint, bigint]} [seconds, nanoseconds]
     */
    static parseString(input: string): [bigint, bigint] {
        // Handle ISO 8601 format: YYYY-MM-DDTHH:mm:ss.sssZ
        const isoRegex = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?Z?$/;
        const match = input.match(isoRegex);
        
        if (match) {
            const [, year, month, day, hour, minute, second, fraction] = match;
            // Create ISO string and parse it to handle timezone correctly
            const isoString = `${year}-${month}-${day}T${hour}:${minute}:${second}${fraction ? `.${fraction}` : ''}Z`;
            const timestamp = Date.parse(isoString);
            
            if (isNaN(timestamp)) {
                throw new SurrealError(`Invalid datetime format: ${input}`);
            }
            
            const seconds = BigInt(Math.floor(timestamp / 1000));
            const nanoseconds = fraction 
                ? BigInt(fraction.padEnd(9, '0'))
                : 0n;
                
            return [seconds, nanoseconds];
        }
        
        // Try parsing as Unix timestamp
        const timestamp = Date.parse(input);
        if (!isNaN(timestamp)) {
            const seconds = BigInt(Math.floor(timestamp / 1000));
            const nanoseconds = BigInt((timestamp % 1000) * 1000000);
            return [seconds, nanoseconds];
        }
        
        throw new SurrealError(`Invalid datetime format: ${input}`);
    }

    /**
     * Adds a duration to this datetime.
     * @param {any} duration - The duration to add
     * @returns {DateTime} The resulting datetime
     */
    add(duration: any): DateTime {
        // Check if it's a Duration-like object with toCompact method
        if (!duration || typeof duration.toCompact !== 'function') {
            throw new SurrealError("Can only add Duration to DateTime");
        }
        
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
     * Subtracts a duration from this datetime.
     * @param {any} duration - The duration to subtract
     * @returns {DateTime} The resulting datetime
     */
    sub(duration: any): DateTime {
        // Check if it's a Duration-like object with toCompact method
        if (!duration || typeof duration.toCompact !== 'function') {
            throw new SurrealError("Can only subtract Duration from DateTime");
        }
        
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
     * Calculates the duration between two datetimes.
     * @param {DateTime} other - The other datetime
     * @returns {Duration} The duration between datetimes
     */
    diff(other: DateTime): Duration {
        const totalThis = this.#seconds * SECOND + this.#nanoseconds;
        const totalOther = other.#seconds * SECOND + other.#nanoseconds;
        const diff = totalThis > totalOther ? totalThis - totalOther : totalOther - totalThis;
        
        return Duration.nanoseconds(diff);
    }

    /**
     * @returns {bigint} Total nanoseconds since Unix epoch
     */
    get nanoseconds(): bigint {
        return this.#seconds * SECOND + this.#nanoseconds;
    }

    /**
     * @returns {bigint} Total microseconds since Unix epoch
     */
    get microseconds(): bigint {
        return this.nanoseconds / MICROSECOND;
    }

    /**
     * @returns {bigint} Total milliseconds since Unix epoch
     */
    get milliseconds(): bigint {
        return this.nanoseconds / MILLISECOND;
    }

    /**
     * @returns {bigint} Seconds since Unix epoch
     */
    get seconds(): bigint {
        return this.#seconds;
    }

    /**
     * Creates a DateTime from nanoseconds since Unix epoch.
     * @param {number | bigint} ns - Nanoseconds value
     * @returns {DateTime} The resulting datetime
     */
    static fromEpochNanoseconds(ns: number | bigint): DateTime {
        const n = typeof ns === "bigint" ? ns : BigInt(Math.floor(ns));
        return new DateTime([n / SECOND, n % SECOND]);
    }

    /**
     * Creates a DateTime from microseconds since Unix epoch.
     * @param {number | bigint} µs - Microseconds value
     * @returns {DateTime} The resulting datetime
     */
    static fromEpochMicroseconds(µs: number | bigint): DateTime {
        const n = typeof µs === "bigint" ? µs : BigInt(Math.floor(µs));
        return DateTime.fromEpochNanoseconds(n * MICROSECOND);
    }

    /**
     * Creates a DateTime from milliseconds since Unix epoch.
     * @param {number | bigint} ms - Milliseconds value
     * @returns {DateTime} The resulting datetime
     */
    static fromEpochMilliseconds(ms: number | bigint): DateTime {
        const n = typeof ms === "bigint" ? ms : BigInt(Math.floor(ms));
        return DateTime.fromEpochNanoseconds(n * MILLISECOND);
    }

    /**
     * Creates a DateTime from seconds since Unix epoch.
     * @param {number | bigint} s - Seconds value
     * @returns {DateTime} The resulting datetime
     */
    static fromEpochSeconds(s: number | bigint): DateTime {
        const n = typeof s === "bigint" ? s : BigInt(Math.floor(s));
        return new DateTime([n, 0n]);
    }

    /**
     * Creates a DateTime from a JavaScript Date.
     * @param {Date} date - JavaScript Date object
     * @returns {DateTime} The resulting datetime
     */
    static fromDate(date: Date): DateTime {
        return new DateTime(date);
    }

    /**
     * Creates a DateTime representing the current time.
     * @returns {DateTime} Current datetime
     */
    static #now(): [bigint, bigint] {
        // Check if we're in Node.js/Bun with high resolution time
        if (typeof process !== 'undefined' && process.hrtime) {
            const now = Date.now();
            const hrtime = process.hrtime.bigint();
            const seconds = BigInt(Math.floor(now / 1000));
            const nanoseconds = hrtime % 1000000000n;
            return [seconds, nanoseconds];
        }
        
        // Check if we're in a browser with performance.now()
        if (typeof performance !== 'undefined' && performance.now) {
            const now = performance.now();
            const seconds = BigInt(Math.floor(now / 1000));
            const nanoseconds = BigInt((now % 1000) * 1000000);
            return [seconds, nanoseconds];
        }
        
        // Fallback to standard Date.now()
        const now = Date.now();
        const seconds = BigInt(Math.floor(now / 1000));
        const nanoseconds = BigInt((now % 1000) * 1000000);
        return [seconds, nanoseconds];
    }

    static now(): DateTime {
        return new DateTime();
    }

    /**
     * Creates a DateTime from Unix epoch (1970-01-01T00:00:00Z).
     * @returns {DateTime} Unix epoch datetime
     */
    static epoch(): DateTime {
        return new DateTime([0n, 0n]);
    }
}
