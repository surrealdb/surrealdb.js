import { JsonCodec } from "../codec/json/codec.ts";
import { InvalidDurationError } from "../errors.ts";
import { hasSymbol, INTERVAL_SYMBOL, markSymbol } from "../utils/symbols.ts";
import { Value } from "./value.ts";

/** The months, days and microseconds of an interval */
export interface IntervalParts {
    months?: number;
    days?: number;
    micros?: number | bigint;
}

const I32_MIN = -(2 ** 31);
const I32_MAX = 2 ** 31 - 1;
const I64_MIN = -(2n ** 63n);
const I64_MAX = 2n ** 63n - 1n;
const MICROS_PER_DAY = 86_400_000_000n;
const MICROS_PER_MONTH = 30n * MICROS_PER_DAY;

function checkI32(name: string, value: number): number {
    if (!Number.isInteger(value) || value < I32_MIN || value > I32_MAX) {
        throw new InvalidDurationError(`An interval's ${name} must be a 32-bit integer: ${value}`);
    }
    return value;
}

/**
 * A SurrealDB 4.0 `interval`: a calendar-aware span of months, days and microseconds, kept
 * apart because a month and a day have no fixed length.
 *
 * As on the server, {@link Interval.equals} compares the total in which a month is 30 days and
 * a day is 24 hours, so `1 month` equals `30 days`; {@link Interval.identical} compares the
 * parts as written.
 *
 * A `cbor.2` connection reads an `interval` as an `Interval` and sends one as tag 191. Plain
 * `cbor` has no interval: the server sends one as its ISO 8601 text, and the SDK sends an
 * `Interval` the same way.
 */
export class Interval extends Value {
    static override [Symbol.hasInstance](instance: unknown): boolean {
        return hasSymbol(instance, INTERVAL_SYMBOL);
    }

    /** The months, a 32-bit integer */
    readonly months: number;

    /** The days, a 32-bit integer */
    readonly days: number;

    /** The microseconds, a 64-bit integer */
    readonly micros: bigint;

    /**
     * An interval from its parts, or from a `[months, days, micros]` tuple
     */
    constructor(input: IntervalParts | [number, number, number | bigint] | Interval) {
        super();

        const [months, days, micros] = Array.isArray(input)
            ? input
            : [input.months ?? 0, input.days ?? 0, input.micros ?? 0];

        this.months = checkI32("months", Number(months));
        this.days = checkI32("days", Number(days));

        if (typeof micros === "number" && !Number.isSafeInteger(micros)) {
            throw new InvalidDurationError(`An interval's micros must be an integer: ${micros}`);
        }
        this.micros = BigInt(micros);
        if (this.micros < I64_MIN || this.micros > I64_MAX) {
            throw new InvalidDurationError(
                `An interval's micros must be a 64-bit integer: ${micros}`,
            );
        }

        markSymbol(this, INTERVAL_SYMBOL);
    }

    /**
     * The total in microseconds, in which a month is 30 days and a day is 24 hours
     */
    get normalisedMicros(): bigint {
        return (
            BigInt(this.months) * MICROS_PER_MONTH +
            BigInt(this.days) * MICROS_PER_DAY +
            this.micros
        );
    }

    /**
     * The `[months, days, micros]` of the interval, as `cbor.2` carries one
     */
    toCompact(): [number, number, bigint] {
        return [this.months, this.days, this.micros];
    }

    /**
     * Equal to an interval of the same total, in which a month is 30 days and a day 24 hours
     */
    equals(other: unknown): boolean {
        return other instanceof Interval && other.normalisedMicros === this.normalisedMicros;
    }

    /**
     * Whether both intervals have the same parts, which is stricter than {@link equals}
     */
    identical(other: Interval): boolean {
        return (
            other.months === this.months && other.days === this.days && other.micros === this.micros
        );
    }

    toJSON(): unknown {
        if (Value._useExperimentalToJson) {
            return JsonCodec.DEFAULT.encode(this);
        }
        return this.toString();
    }

    /**
     * The interval as the server displays it, in ISO 8601: `P1Y2M3DT4H5M6.5S`, or `PT0S`
     */
    toString(): string {
        let out = "P";
        const years = Math.trunc(this.months / 12);
        const mons = this.months % 12;
        if (years !== 0) out += `${years}Y`;
        if (mons !== 0) out += `${mons}M`;
        if (this.days !== 0) out += `${this.days}D`;

        if (this.micros !== 0n) {
            out += "T";
            const sign = this.micros < 0n ? "-" : "";
            const abs = this.micros < 0n ? -this.micros : this.micros;
            const hours = abs / 3_600_000_000n;
            const mins = (abs % 3_600_000_000n) / 60_000_000n;
            const secs = (abs % 60_000_000n) / 1_000_000n;
            const frac = abs % 1_000_000n;
            if (hours !== 0n) out += `${sign}${hours}H`;
            if (mins !== 0n) out += `${sign}${mins}M`;
            if (secs !== 0n || frac !== 0n) {
                out += `${sign}${secs}`;
                if (frac !== 0n) out += `.${frac.toString().padStart(6, "0").replace(/0+$/, "")}`;
                out += "S";
            }
        }

        return out === "P" ? "PT0S" : out;
    }
}
