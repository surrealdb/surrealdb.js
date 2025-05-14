import { SurrealError } from "../errors";
import { Value } from "./value";

const NANOSECOND = 1n;
const MICROSECOND = 1000n * NANOSECOND;
const MILLISECOND = 1000n * MICROSECOND;
const SECOND = 1000n * MILLISECOND;
const MINUTE = 60n * SECOND;
const HOUR = 60n * MINUTE;
const DAY = 24n * HOUR;
const WEEK = 7n * DAY;

const units = new Map([
	["ns", NANOSECOND],
	["µs", MICROSECOND],
	["μs", MICROSECOND], // They look similar, but this unit is a different charachter than the one above it.
	["us", MICROSECOND], // needs to come last to be the displayed unit
	["ms", MILLISECOND],
	["s", SECOND],
	["m", MINUTE],
	["h", HOUR],
	["d", DAY],
	["w", WEEK],
]);

const unitsReverse = Array.from(units).reduce((map, [unit, size]) => {
	map.set(size, unit);
	return map;
}, new Map<bigint, string>());

const durationPartRegex = new RegExp(
	`^(\\d+)(${Array.from(units.keys()).join("|")})`,
);

/**
 * A SurrealQL duration value.
 */
export class Duration extends Value {
	readonly #seconds: bigint;
	readonly #nanoseconds: bigint;

	constructor(input: Duration | [number | bigint, number | bigint] | string) {
		super();

		if (input instanceof Duration) {
			this.#seconds = input.#seconds;
			this.#nanoseconds = input.#nanoseconds;
		} else if (typeof input === "string") {
			const [s, ns] = Duration.parseString(input);
			this.#seconds = s;
			this.#nanoseconds = ns;
		} else {
			const s = BigInt(input[0] ?? 0);
			const ns = BigInt(input[1] ?? 0);
			const total = s * SECOND + ns;
			this.#seconds = total / SECOND;
			this.#nanoseconds = total % SECOND;
		}
	}

	static fromCompact([s, ns]:
		| [number | bigint, number | bigint]
		| [number | bigint]
		| []): Duration {
		return new Duration([s ?? 0, ns ?? 0]);
	}

	equals(other: unknown): boolean {
		if (!(other instanceof Duration)) return false;
		return (
			this.#seconds === other.#seconds &&
			this.#nanoseconds === other.#nanoseconds
		);
	}

	toCompact(): [bigint, bigint] | [bigint] | [] {
		return this.#nanoseconds > 0n
			? [this.#seconds, this.#nanoseconds]
			: this.#seconds > 0n
				? [this.#seconds]
				: [];
	}

	toString(): string {
		let remainingSeconds = this.#seconds;
		let result = "";

		// First loop: process all units ≥ 1 second
		for (const [size, unit] of Array.from(unitsReverse).reverse()) {
			if (size >= SECOND) {
				const amount = remainingSeconds / (size / SECOND);
				if (amount > 0n) {
					remainingSeconds %= size / SECOND;
					result += `${amount}${unit}`;
				}
			}
		}

		// Convert remaining seconds to nanoseconds for the sub-second units
		let remainingNanoseconds = remainingSeconds * SECOND + this.#nanoseconds;

		// Second loop: process sub-second units (< 1 second)
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

	toJSON(): string {
		return this.toString();
	}

	static parseString(input: string): [bigint, bigint] {
		let seconds = 0n;
		let nanoseconds = 0n;
		let left = input;

		while (left !== "") {
			const match = left.match(durationPartRegex);
			if (match) {
				const amount = BigInt(match[1]);
				const unit = match[2];
				const factor = units.get(unit);
				if (!factor) throw new SurrealError(`Invalid duration unit: ${unit}`);

				if (factor >= SECOND) {
					seconds += amount * (factor / SECOND);
				} else {
					nanoseconds += amount * factor;
				}

				left = left.slice(match[0].length);
			} else {
				throw new SurrealError("Could not match a next duration part");
			}
		}

		// Normalize: convert excess nanoseconds to seconds
		seconds += nanoseconds / SECOND;
		nanoseconds %= SECOND;

		return [seconds, nanoseconds];
	}

	static nanoseconds(ns: number | bigint): Duration {
		const total = BigInt(ns);
		return new Duration([total / SECOND, total % SECOND]);
	}

	static microseconds(µs: number | bigint): Duration {
		const ns = BigInt(µs) * MICROSECOND;
		return Duration.nanoseconds(ns);
	}

	static milliseconds(ms: number | bigint): Duration {
		const ns = BigInt(ms) * MILLISECOND;
		return Duration.nanoseconds(ns);
	}

	static seconds(s: number | bigint): Duration {
		return new Duration([BigInt(s), 0n]);
	}

	static minutes(m: number | bigint): Duration {
		return new Duration([BigInt(m) * (MINUTE / SECOND), 0n]);
	}

	static hours(h: number | bigint): Duration {
		return new Duration([BigInt(h) * (HOUR / SECOND), 0n]);
	}

	static days(d: number | bigint): Duration {
		return new Duration([BigInt(d) * (DAY / SECOND), 0n]);
	}

	static weeks(w: number | bigint): Duration {
		return new Duration([BigInt(w) * (WEEK / SECOND), 0n]);
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
		const factorBig = BigInt(factor);

		const totalNs = this.#seconds * SECOND + this.#nanoseconds;
		const resultNs = totalNs * factorBig;

		const sec = resultNs / SECOND;
		const ns = resultNs % SECOND;
		return new Duration([sec, ns]);
	}

	div(divisor: Duration): bigint;
	div(divisor: number | bigint): Duration;
	div(divisor: number | bigint | Duration): bigint | Duration {
		if (typeof divisor === "object" && divisor instanceof Duration) {
			// returns a ratio (unitless bigint)
			const a = this.#seconds * SECOND + this.#nanoseconds;
			const b = divisor.#seconds * SECOND + divisor.#nanoseconds;
			if (b === 0n) throw new SurrealError("Division by zero duration");
			return a / b;
		}

		const divisorBig = BigInt(divisor);
		if (divisorBig === 0n) throw new SurrealError("Division by zero");
		const totalNs = this.#seconds * SECOND + this.#nanoseconds;
		const resultNs = totalNs / divisorBig;
		return new Duration([resultNs / SECOND, resultNs % SECOND]);
	}

	mod(mod: Duration): Duration {
		const a = this.#seconds * SECOND + this.#nanoseconds;
		const b = mod.#seconds * SECOND + mod.#nanoseconds;
		if (b === 0n) throw new SurrealError("Modulo by zero duration");
		const resultNs = a % b;
		return new Duration([resultNs / SECOND, resultNs % SECOND]);
	}
}
