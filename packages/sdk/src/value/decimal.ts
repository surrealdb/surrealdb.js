import { Value } from "./value";

/**
 * Represents a high-precision decimal number with an integer and fractional part.
 * Useful for financial and scientific calculations that require precision beyond JavaScript's native number type.
 */
export class Decimal extends Value {
	#int: bigint;
	#frac: bigint;
	#scale: number;

	/**
	 * Constructs a Decimal from various types.
	 * @param input - The input to construct from: string, number, bigint, Decimal, or a tuple [int, frac, scale].
	 */
	constructor(
		input: string | number | bigint | Decimal | [bigint, bigint, number],
	) {
		super();

		if (input instanceof Decimal) {
			// Clone from another Decimal
			this.#int = input.#int;
			this.#frac = input.#frac;
			this.#scale = input.#scale;
			return;
		}

		if (typeof input === "bigint") {
			// Treat bigint as integer with no fractional part
			this.#int = input;
			this.#frac = 0n;
			this.#scale = 0;
			return;
		}

		if (Array.isArray(input)) {
			// Unpack int, frac, and scale and normalize overflow in fractional part
			let [int, frac, scale] = input;
			const maxFrac = 10n ** BigInt(scale);
			if (frac >= maxFrac) {
				int += frac / maxFrac;
				frac %= maxFrac;
			}
			this.#int = int;
			this.#frac = frac;
			this.#scale = scale;
			return;
		}

		if (typeof input === "string" && /e/i.test(input)) {
			// Parse scientific notation like "1.23e4"
			const dec = Decimal.fromScientificNotation(input);
			this.#int = dec.#int;
			this.#frac = dec.#frac;
			this.#scale = dec.#scale;
			return;
		}

		// Convert string/number to string and trim whitespace
		const str = input.toString().trim();
		const isNegative = str.startsWith("-");
		const clean = isNegative ? str.slice(1) : str;
		const [intStrRaw, fracStrRaw = ""] = clean.split(".");

		// Sanitize int/frac parts
		const safeInt = /^\d+$/.test(intStrRaw) ? intStrRaw : "0";
		const safeFrac = /^\d+$/.test(fracStrRaw) ? fracStrRaw : "0";

		const intStr = safeInt || "0";
		const fracStr = safeFrac.padEnd(safeFrac.length || 1, "0");

		// Parse parts to bigint
		const absInt = BigInt(intStr);
		const absFrac = BigInt(fracStr);

		// Apply sign
		this.#int = isNegative ? -absInt : absInt;
		this.#frac = isNegative ? -absFrac : absFrac;
		this.#scale = safeFrac.length;
	}

	/** Returns the integer part of the number. */
	get int(): bigint {
		return this.#int;
	}

	/** Returns the fractional part of the number. */
	get frac(): bigint {
		return this.#frac;
	}

	/** Returns the scale (number of decimal places). */
	get scale(): number {
		return this.#scale;
	}

	/**
	 * Returns the string representation of the decimal.
	 * Trailing zeros in fractional part are trimmed.
	 * @returns The canonical string format.
	 */
	toString(): string {
		const sign = this.#int < 0n || this.#frac < 0n ? "-" : "";
		const absInt = this.#int < 0n ? -this.#int : this.#int;
		const absFrac = this.#frac < 0n ? -this.#frac : this.#frac;

		if (this.#scale === 0) return `${sign}${absInt}`;

		// Convert frac to string and pad it, then trim trailing zeroes
		let fracStr = absFrac.toString().padStart(this.#scale, "0");
		fracStr = fracStr.replace(/0+$/, "");

		return fracStr === "" ? `${sign}${absInt}` : `${sign}${absInt}.${fracStr}`;
	}

	/**
	 * Serializes the Decimal to JSON string format.
	 * @returns String form.
	 */
	toJSON(): string {
		return this.toString();
	}

	/**
	 * Checks equality between this and another Decimal.
	 * @param other - Another Decimal to compare against.
	 * @returns True if numerically equal.
	 */
	equals(other: unknown): boolean {
		if (!(other instanceof Decimal)) return false;
		const a = this.toBigIntWithScale();
		const b = other.toBigIntWithScale();
		const scale = Math.max(a.scale, b.scale);
		const aVal = a.value * 10n ** BigInt(scale - a.scale);
		const bVal = b.value * 10n ** BigInt(scale - b.scale);
		return aVal === bVal;
	}

	/**
	 * Adds another Decimal to this one.
	 * @param other - The Decimal to add.
	 * @returns A new Decimal representing the sum.
	 */
	add(other: Decimal): Decimal {
		const a = this.toBigIntWithScale();
		const b = other.toBigIntWithScale();
		const scale = Math.max(a.scale, b.scale);
		const scaleDiffA = BigInt(scale - a.scale);
		const scaleDiffB = BigInt(scale - b.scale);
		const valA = a.value * 10n ** scaleDiffA;
		const valB = b.value * 10n ** scaleDiffB;
		const sum = valA + valB;
		const intPart = sum / 10n ** BigInt(scale);
		const fracPart = sum % 10n ** BigInt(scale);
		return new Decimal([intPart, fracPart, scale]);
	}

	/**
	 * Subtracts another Decimal from this one.
	 * @param other - The Decimal to subtract.
	 * @returns A new Decimal representing the difference.
	 */
	sub(other: Decimal): Decimal {
		const a = this.toBigIntWithScale();
		const b = other.toBigIntWithScale();
		const scale = Math.max(a.scale, b.scale);
		const factorA = 10n ** BigInt(scale - a.scale);
		const factorB = 10n ** BigInt(scale - b.scale);
		const valA = a.value * factorA;
		const valB = b.value * factorB;
		const result = valA - valB;
		const intPart = result / 10n ** BigInt(scale);
		const fracPart = result % 10n ** BigInt(scale);
		return new Decimal([intPart, fracPart, scale]);
	}

	/**
	 * Multiplies this Decimal by another.
	 * @param other - The Decimal to multiply by.
	 * @returns A new Decimal representing the product.
	 */
	mul(other: Decimal): Decimal {
		const a = this.toBigIntWithScale();
		const b = other.toBigIntWithScale();
		const result = a.value * b.value;
		const scale = a.scale + b.scale;
		const intPart = result / 10n ** BigInt(scale);
		const fracPart = result % 10n ** BigInt(scale);
		return new Decimal([intPart, fracPart, scale]);
	}

	/**
	 * Divides this Decimal by another, with fixed precision.
	 * @param other - The Decimal to divide by.
	 * @returns A new Decimal representing the quotient.
	 */
	div(other: Decimal): Decimal {
		const a = this.toBigIntWithScale();
		const b = other.toBigIntWithScale();
		if (b.value === 0n) throw new Error("Division by zero");
		const targetScale = 38;
		const scaleDiff = BigInt(targetScale + b.scale - a.scale);
		const scaledA = a.value * 10n ** scaleDiff;
		const result = scaledA / b.value;
		const intPart = result / 10n ** BigInt(targetScale);
		const fracPart = result % 10n ** BigInt(targetScale);
		return new Decimal([intPart, fracPart, targetScale]);
	}

	/**
	 * Computes the remainder of this Decimal divided by another.
	 * @param other - The divisor Decimal.
	 * @returns A new Decimal representing the remainder.
	 */
	mod(other: Decimal): Decimal {
		const a = this.toBigIntWithScale();
		const b = other.toBigIntWithScale();

		if (b.value === 0n) throw new Error("Modulo by zero");

		const scale = Math.max(a.scale, b.scale);
		const scaleDiffA = BigInt(scale - a.scale);
		const scaleDiffB = BigInt(scale - b.scale);

		const valA = a.value * 10n ** scaleDiffA;
		const valB = b.value * 10n ** scaleDiffB;

		const result = valA % valB;
		const intPart = result / 10n ** BigInt(scale);
		const fracPart = result % 10n ** BigInt(scale);

		return new Decimal([intPart, fracPart, scale]);
	}

	/**
	 * Returns the absolute value of this Decimal.
	 * @returns A new Decimal with non-negative components.
	 */
	abs(): Decimal {
		return this.#int < 0n || this.#frac < 0n
			? new Decimal([
					this.#int < 0n ? -this.#int : this.#int,
					this.#frac < 0n ? -this.#frac : this.#frac,
					this.#scale,
				])
			: this;
	}

	/**
	 * Returns the negated value of this Decimal.
	 * @returns A new Decimal with inverted sign.
	 */
	neg(): Decimal {
		return new Decimal([-this.#int, -this.#frac, this.#scale]);
	}

	/**
	 * Checks if the value is exactly zero.
	 * @returns True if both int and frac parts are zero.
	 */
	isZero(): boolean {
		return this.#int === 0n && this.#frac === 0n;
	}

	/**
	 * Checks if the value is negative.
	 * @returns True if negative.
	 */
	isNegative(): boolean {
		return this.#int < 0n || (this.#int === 0n && this.#frac < 0n);
	}

	/**
	 * Compares this Decimal with another.
	 * @param other - The Decimal to compare with.
	 * @returns -1 if less, 0 if equal, 1 if greater.
	 */
	compare(other: Decimal): number {
		const a = this.toBigIntWithScale();
		const b = other.toBigIntWithScale();
		const scale = Math.max(a.scale, b.scale);
		const aVal = a.value * 10n ** BigInt(scale - a.scale);
		const bVal = b.value * 10n ** BigInt(scale - b.scale);
		if (aVal < bVal) return -1;
		if (aVal > bVal) return 1;
		return 0;
	}

	/**
	 * Rounds the Decimal to a fixed number of decimal places.
	 * @param precision - Number of digits to keep after the decimal point.
	 * @returns A new rounded Decimal.
	 */
	round(precision: number): Decimal {
		if (precision < 0) throw new Error("Precision must be >= 0");

		const full = this.toBigIntWithScale();

		// If current scale is already less than or equal to target precision
		if (this.#scale <= precision) {
			const factor = 10n ** BigInt(precision - this.#scale);
			const newValue = full.value * factor;
			const intPart = newValue / 10n ** BigInt(precision);
			const fracPart = newValue % 10n ** BigInt(precision);
			return new Decimal([intPart, fracPart, precision]);
		}

		// Round by removing digits past target precision
		const factor = 10n ** BigInt(this.#scale - precision);
		const half = factor / 2n;
		const rounded =
			full.value >= 0n
				? (full.value + half) / factor
				: (full.value - half) / factor;
		const intPart = rounded / 10n ** BigInt(precision);
		const fracPart = rounded % 10n ** BigInt(precision);
		return new Decimal([intPart, fracPart, precision]);
	}

	/**
	 * Converts the number to fixed-point notation string.
	 * @param precision - Number of digits after the decimal point.
	 * @returns A string representation with fixed decimals.
	 */
	toFixed(precision: number): string {
		const rounded = this.round(precision);
		const sign = rounded.int < 0n || rounded.frac < 0n ? "-" : "";
		const absInt = rounded.int < 0n ? -rounded.int : rounded.int;

		if (precision === 0) {
			return `${sign}${absInt}`;
		}

		const absFrac = rounded.frac < 0n ? -rounded.frac : rounded.frac;
		const fracStr = absFrac.toString().padStart(precision, "0");
		return `${sign}${absInt}.${fracStr}`;
	}

	/**
	 * Converts the Decimal to a native JavaScript number.
	 * @returns A number approximation (may lose precision).
	 */
	toFloat(): number {
		return Number(this.toString());
	}

	/**
	 * Converts to bigint by truncating the fractional part.
	 * @returns An integer approximation.
	 */
	toBigInt(): bigint {
		if (this.#int >= 0n) return this.#int;
		if (this.#frac !== 0n) return this.#int - 1n;
		return this.#int;
	}

	/**
	 * Returns the raw parts of the Decimal.
	 * @returns An object with int, frac, and scale.
	 */
	toParts(): { int: bigint; frac: bigint; scale: number } {
		return {
			int: this.#int,
			frac: this.#frac,
			scale: this.#scale,
		};
	}

	/**
	 * Converts to scientific notation string (e.g., "1.23e4").
	 * @returns Scientific string representation.
	 */
	toScientific(): string {
		if (this.isZero()) return "0e0";

		const negative = this.isNegative();
		const abs = negative ? this.neg() : this;
		const str = abs.toString();
		const [intPart, fracPart = ""] = str.split(".");
		const raw = (intPart + fracPart).replace(/^0+/, "");
		const firstSig = raw.search(/[1-9]/);
		if (firstSig === -1) return "0e0";

		let exponent: number;
		if (intPart !== "0") {
			exponent = intPart.length - 1;
		} else {
			const leadingZeros = fracPart.match(/^0+/);
			exponent = -(leadingZeros?.[0].length || 0) - 1;
		}

		const digits = raw.replace(/0+$/, "");
		const mantissa =
			digits.length > 1 ? `${digits[0]}.${digits.slice(1)}` : digits[0];
		return `${negative ? "-" : ""}${mantissa}e${exponent}`;
	}

	/**
	 * Parses a number in scientific notation into a Decimal.
	 * @param input - The scientific notation string.
	 * @returns A Decimal instance.
	 */
	static fromScientificNotation(input: string): Decimal {
		const match = input.trim().match(/^([+-]?\d*\.?\d+)[eE]([+-]?\d+)$/);
		if (!match) throw new Error(`Invalid scientific notation: ${input}`);

		const [, baseStr, expStr] = match;
		const exp = Number.parseInt(expStr, 10);
		const negative = baseStr.startsWith("-");
		const [intPart, fracPart = ""] = baseStr.replace(/^[-+]/, "").split(".");

		const digits = (intPart + fracPart).replace(/^0+/, "") || "0";
		const pointIndex = intPart.length;
		const newPointIndex = pointIndex + exp;

		let result: string;
		if (newPointIndex <= 0) {
			result = `0.${"0".repeat(-newPointIndex)}${digits}`;
		} else if (newPointIndex >= digits.length) {
			result = digits + "0".repeat(newPointIndex - digits.length);
		} else {
			result = `${digits.slice(0, newPointIndex)}.${digits.slice(newPointIndex)}`;
		}

		return new Decimal(negative ? `-${result}` : result);
	}

	private toBigIntWithScale(): { value: bigint; scale: number } {
		return {
			value: this.#int * 10n ** BigInt(this.#scale) + this.#frac,
			scale: this.#scale,
		};
	}
}
