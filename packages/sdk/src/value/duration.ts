/**
 * SurrealQL Duration class supporting nanosecond precision.
 * Represents a time span, serializable and compatible with arithmetic operations.
 */
import { SurrealError } from "../errors";
import { Value } from "./value";

// Time unit definitions in nanoseconds
const NANOSECOND = 1n;
const MICROSECOND = 1000n * NANOSECOND;
const MILLISECOND = 1000n * MICROSECOND;
const SECOND = 1000n * MILLISECOND;
const MINUTE = 60n * SECOND;
const HOUR = 60n * MINUTE;
const DAY = 24n * HOUR;
const WEEK = 7n * DAY;

// Unit string to nanosecond mapping
const units = new Map([
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
]);

// Reverse map: nanoseconds to unit string
const unitsReverse = Array.from(units).reduce((map, [unit, size]) => {
	map.set(size, unit);
	return map;
}, new Map<bigint, string>());

// Regex for parsing duration parts like "3h" or "15ms"
const escapeRegex = (str: string) =>
	str.replace(/[-\/\\^$*+?.()|[\]{}]/g, "\\$&");

const durationPartRegex = new RegExp(
	`^(\\d+)(${Array.from(units.keys()).map(escapeRegex).join("|")})`,
);

/**
 * A high-precision duration class supporting parsing, formatting, and arithmetic.
 */
export class Duration extends Value {
	readonly #seconds: bigint;
	readonly #nanoseconds: bigint;

	/**
	 * Constructs a new Duration.
	 * @param {Duration | [number|bigint, number|bigint] | string} input - Duration input
	 */
	constructor(input: Duration | [number | bigint, number | bigint] | string) {
		super();

		if (input instanceof Duration) {
			// Clone from existing duration
			this.#seconds = input.#seconds;
			this.#nanoseconds = input.#nanoseconds;
		} else if (typeof input === "string") {
			// Parse from a human-readable string like "1h30m"
			const [s, ns] = Duration.parseString(input);
			this.#seconds = s;
			this.#nanoseconds = ns;
		} else {
			// Construct from tuple [seconds, nanoseconds]
			const s =
				typeof input[0] === "bigint"
					? input[0]
					: BigInt(Math.floor(input[0] ?? 0));

			const ns =
				typeof input[1] === "bigint"
					? input[1]
					: BigInt(Math.floor(input[1] ?? 0));

			const total = s * SECOND + ns;
			// Normalize total into separate seconds and nanoseconds fields
			this.#seconds = total / SECOND;
			this.#nanoseconds = total % SECOND;
		}
	}

	/**
	 * Creates a duration from a compact array form.
	 * @param {[number|bigint, number|bigint] | [number|bigint] | []} param0 - Tuple input
	 * @returns {Duration} New duration
	 */
	static fromCompact([s, ns]:
		| [number | bigint, number | bigint]
		| [number | bigint]
		| []): Duration {
		return new Duration([s ?? 0n, ns ?? 0n]);
	}

	/**
	 * Compares two durations.
	 * @param {unknown} other - Another value
	 * @returns {boolean} True if equal
	 */
	equals(other: unknown): boolean {
		if (!(other instanceof Duration)) return false;
		return (
			this.#seconds === other.#seconds &&
			this.#nanoseconds === other.#nanoseconds
		);
	}

	/**
	 * Converts the duration to a tuple.
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
	 * Formats the duration as a human-readable string.
	 * @returns {string} Duration string
	 */
	toString(): string {
		let remainingSeconds = this.#seconds;
		let result = "";

		// Convert seconds into largest possible whole units (≥ 1s)
		for (const [size, unit] of Array.from(unitsReverse).reverse()) {
			if (size >= SECOND) {
				const amount = remainingSeconds / (size / SECOND);
				if (amount > 0n) {
					remainingSeconds %= size / SECOND;
					result += `${amount}${unit}`;
				}
			}
		}

		// Convert remaining seconds to nanoseconds
		let remainingNanoseconds = remainingSeconds * SECOND + this.#nanoseconds;

		// Convert sub-second nanoseconds to units < 1s
		for (const [size, unit] of Array.from(unitsReverse).reverse()) {
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
	 * Serializes duration to a JSON string.
	 * @returns {string}
	 */
	toJSON(): string {
		return this.toString();
	}

	/**
	 * Parses a duration string like "1h30m".
	 * @param {string} input - Input string
	 * @returns {[bigint, bigint]} [seconds, nanoseconds]
	 */
	static parseString(input: string): [bigint, bigint] {
		let seconds = 0n;
		let nanoseconds = 0n;
		let left = input;

		// Loop through string and extract valid duration parts
		while (left !== "") {
			const match = left.match(durationPartRegex);
			if (match) {
				const amount = BigInt(match[1]);
				const unit = match[2];
				const factor = units.get(unit);
				if (!factor) throw new SurrealError(`Invalid duration unit: ${unit}`);

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
				throw new SurrealError("Could not match a next duration part");
			}
		}

		// Normalize: convert overflow nanoseconds to seconds
		seconds += nanoseconds / SECOND;
		nanoseconds %= SECOND;
		return [seconds, nanoseconds];
	}

	/**
	 * Adds two durations together.
	 * @param {Duration} other - The duration to add
	 * @returns {Duration} The resulting duration
	 */
	add(other: Duration): Duration {
		let sec = this.#seconds + other.#seconds;
		let ns = this.#nanoseconds + other.#nanoseconds;
		if (ns >= SECOND) {
			sec += 1n;
			ns -= SECOND;
		}
		return new Duration([sec, ns]);
	}

	/**
	 * Subtracts another duration from this one.
	 * @param {Duration} other - The duration to subtract
	 * @returns {Duration} The resulting duration
	 */
	sub(other: Duration): Duration {
		let sec = this.#seconds - other.#seconds;
		let ns = this.#nanoseconds - other.#nanoseconds;
		if (ns < 0n) {
			sec -= 1n;
			ns += SECOND;
		}
		return new Duration([sec, ns]);
	}

	/**
	 * Multiplies the duration by a scalar.
	 * @param {number | bigint} factor - The factor to multiply by
	 * @returns {Duration} The resulting duration
	 */
	mul(factor: number | bigint): Duration {
		const factorBig =
			typeof factor === "bigint" ? factor : BigInt(Math.floor(factor));
		const totalNs = this.#seconds * SECOND + this.#nanoseconds;
		const resultNs = totalNs * factorBig;
		return new Duration([resultNs / SECOND, resultNs % SECOND]);
	}

	/**
	 * Divides the duration.
	 * @param {Duration | number | bigint} divisor - The duration or scalar to divide by
	 * @returns {Duration | bigint} A new Duration or ratio (unitless bigint)
	 */
	div(divisor: Duration): bigint;
	div(divisor: number | bigint): Duration;
	div(divisor: number | bigint | Duration): bigint | Duration {
		if (typeof divisor === "object" && divisor instanceof Duration) {
			const a = this.#seconds * SECOND + this.#nanoseconds;
			const b = divisor.#seconds * SECOND + divisor.#nanoseconds;
			if (b === 0n) throw new SurrealError("Division by zero duration");
			return a / b;
		}
		const divisorBig =
			typeof divisor === "bigint" ? divisor : BigInt(Math.floor(divisor));
		if (divisorBig === 0n) throw new SurrealError("Division by zero");
		const totalNs = this.#seconds * SECOND + this.#nanoseconds;
		const resultNs = totalNs / divisorBig;
		return new Duration([resultNs / SECOND, resultNs % SECOND]);
	}

	/**
	 * Computes the remainder after division.
	 * @param {Duration} mod - The divisor
	 * @returns {Duration} The remainder duration
	 */
	mod(mod: Duration): Duration {
		const a = this.#seconds * SECOND + this.#nanoseconds;
		const b = mod.#seconds * SECOND + mod.#nanoseconds;
		if (b === 0n) throw new SurrealError("Modulo by zero duration");
		const resultNs = a % b;
		return new Duration([resultNs / SECOND, resultNs % SECOND]);
	}

	/**
	 * @returns {bigint} Total nanoseconds in this duration
	 */
	get nanoseconds(): bigint {
		return this.#seconds * SECOND + this.#nanoseconds;
	}

	/**
	 * @returns {bigint} Total microseconds
	 */
	get microseconds(): bigint {
		return this.nanoseconds / MICROSECOND;
	}

	/**
	 * @returns {bigint} Total milliseconds
	 */
	get milliseconds(): bigint {
		return this.nanoseconds / MILLISECOND;
	}

	/**
	 * @returns {bigint} Whole seconds in the duration
	 */
	get seconds(): bigint {
		return this.#seconds;
	}

	/**
	 * @returns {bigint} Total whole minutes in the duration
	 */
	get minutes(): bigint {
		return this.#seconds / (MINUTE / SECOND);
	}

	/**
	 * @returns {bigint} Total whole hours in the duration
	 */
	get hours(): bigint {
		return this.#seconds / (HOUR / SECOND);
	}

	/**
	 * @returns {bigint} Total whole days in the duration
	 */
	get days(): bigint {
		return this.#seconds / (DAY / SECOND);
	}

	/**
	 * @returns {bigint} Total whole weeks in the duration
	 */
	get weeks(): bigint {
		return this.#seconds / (WEEK / SECOND);
	}

	/**
	 * Creates a Duration from nanoseconds.
	 * @param {number | bigint} ns - Nanoseconds value
	 * @returns {Duration} The resulting duration
	 */
	static nanoseconds(ns: number | bigint): Duration {
		const n = typeof ns === "bigint" ? ns : BigInt(Math.floor(ns));
		return new Duration([n / SECOND, n % SECOND]);
	}

	/**
	 * Creates a Duration from microseconds.
	 * @param {number | bigint} µs - Microseconds value
	 * @returns {Duration} The resulting duration
	 */
	static microseconds(µs: number | bigint): Duration {
		const n = typeof µs === "bigint" ? µs : BigInt(Math.floor(µs));
		return Duration.nanoseconds(n * MICROSECOND);
	}

	/**
	 * Creates a Duration from milliseconds.
	 * @param {number | bigint} ms - Milliseconds value
	 * @returns {Duration} The resulting duration
	 */
	static milliseconds(ms: number | bigint): Duration {
		const n = typeof ms === "bigint" ? ms : BigInt(Math.floor(ms));
		return Duration.nanoseconds(n * MILLISECOND);
	}

	/**
	 * Creates a Duration from seconds.
	 * @param {number | bigint} s - Seconds value
	 * @returns {Duration} The resulting duration
	 */
	static seconds(s: number | bigint): Duration {
		const n = typeof s === "bigint" ? s : BigInt(Math.floor(s));
		return new Duration([n, 0n]);
	}

	/**
	 * Creates a Duration from minutes.
	 * @param {number | bigint} m - Minutes value
	 * @returns {Duration} The resulting duration
	 */
	static minutes(m: number | bigint): Duration {
		const n = typeof m === "bigint" ? m : BigInt(Math.floor(m));
		return new Duration([n * (MINUTE / SECOND), 0n]);
	}

	/**
	 * Creates a Duration from hours.
	 * @param {number | bigint} h - Hours value
	 * @returns {Duration} The resulting duration
	 */
	static hours(h: number | bigint): Duration {
		const n = typeof h === "bigint" ? h : BigInt(Math.floor(h));
		return new Duration([n * (HOUR / SECOND), 0n]);
	}

	/**
	 * Creates a Duration from days.
	 * @param {number | bigint} d - Days value
	 * @returns {Duration} The resulting duration
	 */
	static days(d: number | bigint): Duration {
		const n = typeof d === "bigint" ? d : BigInt(Math.floor(d));
		return new Duration([n * (DAY / SECOND), 0n]);
	}

	/**
	 * Creates a Duration from weeks.
	 * @param {number | bigint} w - Weeks value
	 * @returns {Duration} The resulting duration
	 */
	static weeks(w: number | bigint): Duration {
		const n = typeof w === "bigint" ? w : BigInt(Math.floor(w));
		return new Duration([n * (WEEK / SECOND), 0n]);
	}
}
