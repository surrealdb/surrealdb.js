import { JsonCodec } from "../codec/json/codec.ts";
import { InvalidDateError } from "../errors.ts";
import { formatTime, NANOS_PER_DAY, NANOS_PER_SECOND, parseTime } from "../internal/calendar.ts";
import { hasSymbol, markSymbol, PLAIN_TIME_SYMBOL } from "../utils/symbols.ts";
import { Value } from "./value.ts";

/**
 * A SurrealDB 4.0 `time`: a time of day without a date or a time zone, held as nanoseconds
 * since midnight, from `00:00:00` to `24:00:00` inclusive.
 *
 * A `cbor.2` connection reads a `time` as a `PlainTime` and sends one as tag 189. Plain `cbor`
 * has no time: the server sends one as a duration since midnight, and the SDK sends a
 * `PlainTime` the same way.
 */
export class PlainTime extends Value {
    static override [Symbol.hasInstance](instance: unknown): boolean {
        return hasSymbol(instance, PLAIN_TIME_SYMBOL);
    }

    /**
     * The number of nanoseconds since midnight
     */
    readonly nanos: number;

    /**
     * A time from its nanoseconds since midnight, or from `H:MM[:SS[.fraction]]`.
     */
    constructor(input: number | bigint | string | PlainTime) {
        super();

        if (input instanceof PlainTime) {
            this.nanos = input.nanos;
        } else if (typeof input === "string") {
            this.nanos = parseTime(input);
        } else {
            const nanos = Number(input);
            if (!Number.isSafeInteger(nanos) || nanos < 0 || nanos > NANOS_PER_DAY) {
                throw new InvalidDateError(`A time cannot be ${input} nanoseconds past midnight`);
            }
            this.nanos = nanos;
        }

        markSymbol(this, PLAIN_TIME_SYMBOL);
    }

    /** The hour, from 0 to 24 */
    get hours(): number {
        return Math.floor(this.nanos / (3600 * NANOS_PER_SECOND));
    }

    /** The minute, from 0 to 59 */
    get minutes(): number {
        return Math.floor(this.nanos / (60 * NANOS_PER_SECOND)) % 60;
    }

    /** The second, from 0 to 59 */
    get seconds(): number {
        return Math.floor(this.nanos / NANOS_PER_SECOND) % 60;
    }

    /** The nanoseconds within the second */
    get nanoseconds(): number {
        return this.nanos % NANOS_PER_SECOND;
    }

    equals(other: unknown): boolean {
        return other instanceof PlainTime && other.nanos === this.nanos;
    }

    toJSON(): unknown {
        if (Value._useExperimentalToJson) {
            return JsonCodec.DEFAULT.encode(this);
        }
        return this.toString();
    }

    /**
     * The time as the server displays it: `HH:MM:SS`, with a fraction when it has one
     */
    toString(): string {
        return formatTime(this.nanos);
    }
}
