import { JsonCodec } from "../codec/json/codec.ts";
import { InvalidDateError } from "../errors.ts";
import {
    civilFromDays,
    daysFromCivil,
    formatDate,
    MAX_DAYS,
    MIN_DAYS,
    parseDate,
} from "../internal/calendar.ts";
import { hasSymbol, markSymbol, PLAIN_DATE_SYMBOL } from "../utils/symbols.ts";
import { Value } from "./value.ts";

/**
 * A SurrealDB 4.0 `date`: a calendar date without a time or a time zone, held as a count of
 * days since 1970-01-01 in the proleptic Gregorian calendar.
 *
 * The earliest and latest dates the server holds stand for `-infinity` and `infinity`, which
 * {@link PlainDate.NEG_INFINITY} and {@link PlainDate.INFINITY} are.
 *
 * A `cbor.2` connection reads a `date` as a `PlainDate` and sends one as tag 100. Plain `cbor`
 * has no date: the server sends one as a datetime at midnight UTC, and the SDK sends a
 * `PlainDate` the same way.
 */
export class PlainDate extends Value {
    static override [Symbol.hasInstance](instance: unknown): boolean {
        return hasSymbol(instance, PLAIN_DATE_SYMBOL);
    }

    /** `infinity`, the latest date */
    static readonly INFINITY: PlainDate = new PlainDate(MAX_DAYS);

    /** `-infinity`, the earliest date */
    static readonly NEG_INFINITY: PlainDate = new PlainDate(MIN_DAYS);

    /**
     * The number of days since 1970-01-01
     */
    readonly days: number;

    /**
     * A date from its days since 1970-01-01, from `YYYY-MM-DD`, from `infinity` or
     * `-infinity`, or from the UTC date of a `Date`.
     */
    constructor(input: number | string | Date | PlainDate) {
        super();

        if (input instanceof PlainDate) {
            this.days = input.days;
        } else if (input instanceof Date) {
            if (Number.isNaN(input.getTime())) throw new InvalidDateError(input);
            this.days = daysFromCivil(
                input.getUTCFullYear(),
                input.getUTCMonth() + 1,
                input.getUTCDate(),
            );
        } else if (typeof input === "string") {
            const text = input.trim().toLowerCase();
            if (text === "infinity" || text === "+infinity") this.days = MAX_DAYS;
            else if (text === "-infinity") this.days = MIN_DAYS;
            else this.days = parseDate(input);
        } else if (Number.isSafeInteger(input) && input >= MIN_DAYS && input <= MAX_DAYS) {
            this.days = input;
        } else {
            throw new InvalidDateError(`A date cannot be ${input} days from 1970-01-01`);
        }

        markSymbol(this, PLAIN_DATE_SYMBOL);
    }

    /** The year, which is 0 for 1 BCE */
    get year(): number {
        return civilFromDays(this.days)[0];
    }

    /** The month, from 1 to 12 */
    get month(): number {
        return civilFromDays(this.days)[1];
    }

    /** The day of the month, from 1 to 31 */
    get day(): number {
        return civilFromDays(this.days)[2];
    }

    /** Whether this is `infinity` or `-infinity` */
    get isInfinite(): boolean {
        return this.days === MAX_DAYS || this.days === MIN_DAYS;
    }

    /**
     * Midnight UTC of this date as a `Date`, or an invalid `Date` past its range
     */
    toDate(): Date {
        return new Date(this.days * 86_400_000);
    }

    equals(other: unknown): boolean {
        return other instanceof PlainDate && other.days === this.days;
    }

    toJSON(): unknown {
        if (Value._useExperimentalToJson) {
            return JsonCodec.DEFAULT.encode(this);
        }
        return this.toString();
    }

    /**
     * The date as the server displays it: `YYYY-MM-DD`, `infinity` or `-infinity`
     */
    toString(): string {
        if (this.days === MAX_DAYS) return "infinity";
        if (this.days === MIN_DAYS) return "-infinity";
        return formatDate(this.days);
    }
}
