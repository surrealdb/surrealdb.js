import { SurrealError } from "../errors";
import { Value } from "./value";

const MILLISECOND = 1;
const MICROSECOND = MILLISECOND / 1000;
const NANOSECOND = MICROSECOND / 1000;
const SECOND = 1000 * MILLISECOND;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const WEEK = 7 * DAY;

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
}, new Map<number, string>());

const durationPartRegex = new RegExp(
	`^(\\d+)(${Array.from(units.keys()).join("|")})`,
);

/**
 * A SurrealQL duration value.
 */
export class Duration extends Value {
	readonly _milliseconds: number;

	constructor(input: Duration | number | string) {
		super();

		if (input instanceof Duration) {
			this._milliseconds = input._milliseconds;
		} else if (typeof input === "string") {
			this._milliseconds = Duration.parseString(input);
		} else {
			this._milliseconds = input;
		}
	}

	static fromCompact([s, ns]: [number, number] | [number] | []): Duration {
		s = s ?? 0;
		ns = ns ?? 0;
		const ms = s * 1000 + ns / 1000000;
		return new Duration(ms);
	}

	equals(other: unknown): boolean {
		if (!(other instanceof Duration)) return false;
		return this._milliseconds === other._milliseconds;
	}

	toCompact(): [number, number] | [number] | [] {
		const s = Math.floor(this._milliseconds / 1000);
		const ns = Math.floor((this._milliseconds - s * 1000) * 1000000);
		return ns > 0 ? [s, ns] : s > 0 ? [s] : [];
	}

	toString(): string {
		let left = this._milliseconds;
		let result = "";
		function scrap(size: number) {
			const num = Math.floor(left / size);
			if (num > 0) left = left % size;
			return num;
		}

		for (const [size, unit] of Array.from(unitsReverse).reverse()) {
			const scrapped = scrap(size);
			if (scrapped > 0) result += `${scrapped}${unit}`;
		}

		return result;
	}

	toJSON(): string {
		return this.toString();
	}

	static parseString(input: string): number {
		let ms = 0;
		let left = input;
		while (left !== "") {
			const match = left.match(durationPartRegex);
			if (match) {
				const amount = Number.parseInt(match[1]);
				const factor = units.get(match[2]);
				if (factor === undefined)
					throw new SurrealError(`Invalid duration unit: ${match[2]}`);

				ms += amount * factor;
				left = left.slice(match[0].length);
				continue;
			}

			throw new SurrealError("Could not match a next duration part");
		}

		return ms;
	}

	static nanoseconds(nanoseconds: number): Duration {
		return new Duration(Math.floor(nanoseconds * NANOSECOND));
	}

	static microseconds(microseconds: number): Duration {
		return new Duration(Math.floor(microseconds * MICROSECOND));
	}

	static milliseconds(milliseconds: number): Duration {
		return new Duration(milliseconds);
	}

	static seconds(seconds: number): Duration {
		return new Duration(seconds * SECOND);
	}

	static minutes(minutes: number): Duration {
		return new Duration(minutes * MINUTE);
	}

	static hours(hours: number): Duration {
		return new Duration(hours * HOUR);
	}

	static days(days: number): Duration {
		return new Duration(days * DAY);
	}

	static weeks(weeks: number): Duration {
		return new Duration(weeks * WEEK);
	}

	get microseconds(): number {
		return Math.floor(this._milliseconds / MICROSECOND);
	}

	get nanoseconds(): number {
		return Math.floor(this._milliseconds / NANOSECOND);
	}

	get milliseconds(): number {
		return Math.floor(this._milliseconds);
	}

	get seconds(): number {
		return Math.floor(this._milliseconds / SECOND);
	}

	get minutes(): number {
		return Math.floor(this._milliseconds / MINUTE);
	}

	get hours(): number {
		return Math.floor(this._milliseconds / HOUR);
	}

	get days(): number {
		return Math.floor(this._milliseconds / DAY);
	}

	get weeks(): number {
		return Math.floor(this._milliseconds / WEEK);
	}
}
