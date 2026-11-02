import { JsonCodec } from "../codec/json/codec.ts";
import { InvalidDateError } from "../errors.ts";
import {
    formatDate,
    formatTime,
    MAX_DAYS,
    MIN_DAYS,
    NANOS_PER_DAY,
    NANOS_PER_SECOND,
    parseDate,
    parseTime,
    SECONDS_PER_DAY,
} from "../internal/calendar.ts";
import { hasSymbol, markSymbol, TIMESTAMP_SYMBOL } from "../utils/symbols.ts";
import { Value } from "./value.ts";

/** The seconds and nanoseconds of a timestamp since 1970-01-01T00:00:00 */
export type TimestampTuple = [seconds: number | bigint, nanoseconds: number | bigint];

const MIN_SECONDS = MIN_DAYS * SECONDS_PER_DAY;
const MAX_SECONDS = MAX_DAYS * SECONDS_PER_DAY + SECONDS_PER_DAY - 1;
const MAX_NANOS = NANOS_PER_SECOND - 1;

/**
 * A SurrealDB 4.0 `timestamp`: a date and time of day without a time zone, a wall-clock time
 * with nanosecond resolution. Unlike a {@link DateTime}, it is not an instant: it names the
 * same reading of a clock wherever it is read.
 *
 * The earliest and latest timestamps the server holds stand for `-infinity` and `infinity`,
 * which {@link Timestamp.NEG_INFINITY} and {@link Timestamp.INFINITY} are.
 *
 * A `cbor.2` connection reads a `timestamp` as a `Timestamp` and sends one as tag 190. Plain
 * `cbor` has no timestamp: the server sends one as the datetime of its reading in UTC, and the
 * SDK sends a `Timestamp` the same way.
 */
export class Timestamp extends Value {
    static override [Symbol.hasInstance](instance: unknown): boolean {
        return hasSymbol(instance, TIMESTAMP_SYMBOL);
    }

    /** `infinity`, the latest timestamp */
    static readonly INFINITY: Timestamp = new Timestamp([MAX_SECONDS, MAX_NANOS]);

    /** `-infinity`, the earliest timestamp */
    static readonly NEG_INFINITY: Timestamp = new Timestamp([MIN_SECONDS, 0]);

    /** The whole seconds since 1970-01-01T00:00:00 */
    readonly seconds: number;

    /** The nanoseconds within the second. A leap second holds one billion or more. */
    readonly nanoseconds: number;

    /**
     * A timestamp from its `[seconds, nanoseconds]` since 1970-01-01T00:00:00, from
     * `YYYY-MM-DDTHH:MM[:SS[.fraction]]` (a space may stand for the `T`), from `infinity` or
     * `-infinity`, or from the UTC reading of a `Date`.
     */
    constructor(input: TimestampTuple | string | Date | Timestamp) {
        super();

        let seconds: number;
        let nanos: number;

        if (input instanceof Timestamp) {
            seconds = input.seconds;
            nanos = input.nanoseconds;
        } else if (input instanceof Date) {
            const ms = input.getTime();
            if (Number.isNaN(ms)) throw new InvalidDateError(input);
            seconds = Math.floor(ms / 1000);
            nanos = (ms - seconds * 1000) * 1_000_000;
        } else if (typeof input === "string") {
            [seconds, nanos] = Timestamp.#parse(input);
        } else {
            seconds = Number(input[0]);
            nanos = Number(input[1]);
        }

        if (
            !Number.isSafeInteger(seconds) ||
            !Number.isSafeInteger(nanos) ||
            seconds < MIN_SECONDS ||
            seconds > MAX_SECONDS ||
            nanos < 0 ||
            nanos >= 2 * NANOS_PER_SECOND
        ) {
            throw new InvalidDateError(`A timestamp cannot be [${seconds}, ${nanos}]`);
        }

        this.seconds = seconds;
        this.nanoseconds = nanos;
        markSymbol(this, TIMESTAMP_SYMBOL);
    }

    static #parse(input: string): [number, number] {
        const text = input.trim();
        const lower = text.toLowerCase();
        if (lower === "infinity" || lower === "+infinity") return [MAX_SECONDS, MAX_NANOS];
        if (lower === "-infinity") return [MIN_SECONDS, 0];
        if (lower === "epoch") return [0, 0];

        const at = text.search(/[T ]/);
        if (at < 0) throw new InvalidDateError(`Invalid timestamp: ${JSON.stringify(input)}`);

        const days = parseDate(text.slice(0, at));
        const nanos = parseTime(text.slice(at + 1));
        if (nanos >= NANOS_PER_DAY) {
            throw new InvalidDateError(`Invalid timestamp: ${JSON.stringify(input)}`);
        }

        const seconds = days * SECONDS_PER_DAY + Math.floor(nanos / NANOS_PER_SECOND);
        return [seconds, nanos % NANOS_PER_SECOND];
    }

    /** Whether this is `infinity` or `-infinity` */
    get isInfinite(): boolean {
        return this.equals(Timestamp.INFINITY) || this.equals(Timestamp.NEG_INFINITY);
    }

    /**
     * The `[seconds, nanoseconds]` since 1970-01-01T00:00:00, as `cbor.2` carries a timestamp
     */
    toCompact(): [number, number] {
        return [this.seconds, this.nanoseconds];
    }

    /**
     * This reading taken as UTC, as a `Date`. The `Date` drops what is below a millisecond.
     */
    toDate(): Date {
        return new Date(this.seconds * 1000 + Math.floor(this.nanoseconds / 1_000_000));
    }

    equals(other: unknown): boolean {
        return (
            other instanceof Timestamp &&
            other.seconds === this.seconds &&
            other.nanoseconds === this.nanoseconds
        );
    }

    toJSON(): unknown {
        if (Value._useExperimentalToJson) {
            return JsonCodec.DEFAULT.encode(this);
        }
        return this.toString();
    }

    /**
     * The timestamp as the server displays it: `YYYY-MM-DDTHH:MM:SS`, with a fraction when it
     * has one, or `infinity` or `-infinity`
     */
    toString(): string {
        if (this.seconds === MAX_SECONDS && this.nanoseconds === MAX_NANOS) return "infinity";
        if (this.seconds === MIN_SECONDS && this.nanoseconds === 0) return "-infinity";

        const days = Math.floor(this.seconds / SECONDS_PER_DAY);
        const secs = this.seconds - days * SECONDS_PER_DAY;
        // A leap second reads as second 60 of its minute
        const nanos = secs * NANOS_PER_SECOND + this.nanoseconds;
        const time =
            this.nanoseconds >= NANOS_PER_SECOND
                ? formatTime(nanos - NANOS_PER_SECOND).replace(/:59(\.|$)/, ":60$1")
                : formatTime(nanos);
        return `${formatDate(days)}T${time}`;
    }
}
