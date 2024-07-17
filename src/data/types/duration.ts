import { SurrealDbError } from "../../errors";

const millisecond = 1;
const microsecond = millisecond / 1000;
const nanosecond = microsecond / 1000;
const second = 1000 * millisecond;
const minute = 60 * second;
const hour = 60 * minute;
const day = 24 * hour;
const week = 7 * day;

const units = new Map([
	["ns", nanosecond],
	["µs", microsecond],
	["μs", microsecond], // They look similar, but this unit is a different charachter than the one above it.
	["us", microsecond], // needs to come last to be the displayed unit
	["ms", millisecond],
	["s", second],
	["m", minute],
	["h", hour],
	["d", day],
	["w", week],
]);

const unitsReverse = Array.from(units).reduce((map, [unit, size]) => {
	map.set(size, unit);
	return map;
}, new Map<number, string>());

const durationPartRegex = new RegExp(
	`^(\\d+)(${Array.from(units.keys()).join("|")})`,
);

export class Duration {
	readonly _milliseconds: number;

	constructor(input: Duration | number | string) {
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
					throw new SurrealDbError(`Invalid duration unit: ${match[2]}`);

				ms += amount * factor;
				left = left.slice(match[0].length);
				continue;
			}

			throw new SurrealDbError("Could not match a next duration part");
		}

		return ms;
	}

	static nanoseconds(nanoseconds: number): Duration {
		return new Duration(Math.floor(nanoseconds * nanosecond));
	}

	static microseconds(microseconds: number): Duration {
		return new Duration(Math.floor(microseconds * microsecond));
	}

	static milliseconds(milliseconds: number): Duration {
		return new Duration(milliseconds);
	}

	static seconds(seconds: number): Duration {
		return new Duration(seconds * second);
	}

	static minutes(minutes: number): Duration {
		return new Duration(minutes * minute);
	}

	static hours(hours: number): Duration {
		return new Duration(hours * hour);
	}

	static days(days: number): Duration {
		return new Duration(days * day);
	}

	static weeks(weeks: number): Duration {
		return new Duration(weeks * week);
	}

	get microseconds(): number {
		return Math.floor(this._milliseconds / microsecond);
	}

	get nanoseconds(): number {
		return Math.floor(this._milliseconds / nanosecond);
	}

	get milliseconds(): number {
		return Math.floor(this._milliseconds);
	}

	get seconds(): number {
		return Math.floor(this._milliseconds / second);
	}

	get minutes(): number {
		return Math.floor(this._milliseconds / minute);
	}

	get hours(): number {
		return Math.floor(this._milliseconds / hour);
	}

	get days(): number {
		return Math.floor(this._milliseconds / day);
	}

	get weeks(): number {
		return Math.floor(this._milliseconds / week);
	}
}
