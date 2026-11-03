import { InvalidDateError } from "../errors.ts";

/** Nanoseconds in a second. */
export const NANOS_PER_SECOND = 1_000_000_000;

/** Seconds in a day. */
export const SECONDS_PER_DAY = 86_400;

/** Nanoseconds in a day, the latest time of day (`24:00:00`). */
export const NANOS_PER_DAY = SECONDS_PER_DAY * NANOS_PER_SECOND;

/**
 * Days since 1970-01-01 of a proleptic Gregorian date, after Howard Hinnant's
 * `days_from_civil`.
 */
export function daysFromCivil(year: number, month: number, day: number): number {
    const y = month <= 2 ? year - 1 : year;
    const era = Math.floor(y / 400);
    const yoe = y - era * 400;
    const doy = Math.floor((153 * (month + (month > 2 ? -3 : 9)) + 2) / 5) + day - 1;
    const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
    return era * 146097 + doe - 719468;
}

/**
 * The proleptic Gregorian `[year, month, day]` of a count of days since 1970-01-01.
 */
export function civilFromDays(days: number): [number, number, number] {
    const z = days + 719468;
    const era = Math.floor(z / 146097);
    const doe = z - era * 146097;
    const yoe = Math.floor(
        (doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365,
    );
    const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
    const mp = Math.floor((5 * doy + 2) / 153);
    const day = doy - Math.floor((153 * mp + 2) / 5) + 1;
    const month = mp < 10 ? mp + 3 : mp - 9;
    return [yoe + era * 400 + (month <= 2 ? 1 : 0), month, day];
}

/**
 * The earliest and latest days the server holds a date in, those of its `chrono::NaiveDate`
 * (-262143-01-01 to +262142-12-31). They stand for `-infinity` and `infinity`.
 */
export const MIN_DAYS = daysFromCivil(-262143, 1, 1);
export const MAX_DAYS = daysFromCivil(262142, 12, 31);

/**
 * A date as the server displays one: `YYYY-MM-DD`, with a sign and at least five digits for a
 * year outside 0 to 9999.
 */
export function formatDate(days: number): string {
    const [year, month, day] = civilFromDays(days);
    const yyyy =
        year >= 0 && year <= 9999
            ? String(year).padStart(4, "0")
            : `${year < 0 ? "-" : "+"}${String(Math.abs(year)).padStart(4, "0")}`;
    return `${yyyy}-${pad2(month)}-${pad2(day)}`;
}

/**
 * The days of a `YYYY-MM-DD` date, which may carry a sign and more year digits.
 */
export function parseDate(text: string): number {
    const match = /^([+-]?\d{4,})-(\d{2})-(\d{2})$/.exec(text.trim());
    if (!match) throw new InvalidDateError(`Invalid date: ${JSON.stringify(text)}`);

    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const days = daysFromCivil(year, month, day);

    // A day past its month's end rolls over: refuse it rather than move the date
    const [y, m, d] = civilFromDays(days);
    if (y !== year || m !== month || d !== day) {
        throw new InvalidDateError(`Invalid date: ${JSON.stringify(text)}`);
    }
    if (days < MIN_DAYS || days > MAX_DAYS) {
        throw new InvalidDateError(`Date out of range: ${JSON.stringify(text)}`);
    }
    return days;
}

/**
 * A time of day as the server displays one: `HH:MM:SS`, with a fraction of 3, 6 or 9 digits
 * when it has one.
 */
export function formatTime(nanos: number): string {
    const secs = Math.floor(nanos / NANOS_PER_SECOND);
    const hh = pad2(Math.floor(secs / 3600));
    const mm = pad2(Math.floor(secs / 60) % 60);
    const ss = pad2(secs % 60);
    return `${hh}:${mm}:${ss}${formatFraction(nanos % NANOS_PER_SECOND)}`;
}

/**
 * The nanoseconds since midnight of `H:MM[:SS[.fraction]]`, up to `24:00:00`, as the server
 * reads a time.
 */
export function parseTime(text: string): number {
    const invalid = () => new InvalidDateError(`Invalid time: ${JSON.stringify(text)}`);
    const match = /^(\d{1,2}):(\d{1,2})(?::(\d{1,2})(?:\.(\d{1,9}))?)?$/.exec(text.trim());
    if (!match) throw invalid();

    const hours = Number(match[1]);
    const mins = Number(match[2]);
    const secs = Number(match[3] ?? 0);
    const frac = match[4] ? Number(match[4].padEnd(9, "0")) : 0;
    if (hours > 24 || mins > 59 || secs > 59) throw invalid();

    const nanos = ((hours * 60 + mins) * 60 + secs) * NANOS_PER_SECOND + frac;
    if (nanos > NANOS_PER_DAY) throw invalid();
    return nanos;
}

/**
 * The fraction of a second the server writes: none for a whole second, otherwise milli-,
 * micro- or nanoseconds, whichever is the shortest exact one.
 */
export function formatFraction(nanos: number): string {
    if (nanos === 0) return "";
    if (nanos % 1_000_000 === 0) return `.${String(nanos / 1_000_000).padStart(3, "0")}`;
    if (nanos % 1_000 === 0) return `.${String(nanos / 1_000).padStart(6, "0")}`;
    return `.${String(nanos).padStart(9, "0")}`;
}

function pad2(value: number): string {
    return String(value).padStart(2, "0");
}
