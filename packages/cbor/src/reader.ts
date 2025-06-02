import { type Major, POW_2_53 } from "./constants";
import { CborInvalidMajorError, CborRangeError } from "./error";

// Float16 constants
const F16_SIGN_MASK = 0x8000;
const F16_EXP_MASK = 0x7c00;
const F16_FRAC_MASK = 0x03ff;
const F16_EXP_SHIFT = 10;
const F16_EXP_BIAS = 15;
const F16_EXP_INF_NAN = 0x1f;
const F16_FRAC_SCALE = 1024;
const F16_SUBNORMAL_SCALE = 2 ** -14;

// Optional: Precomputed exponent powers for float16
const FLOAT16_EXP_LUT = Array.from(
	{ length: 31 },
	(_, e) => 2 ** (e - F16_EXP_BIAS),
);

export class Reader {
	private _view: DataView;
	private _byte: Uint8Array;
	private _pos = 0;

	constructor(buffer: Uint8Array) {
		this._byte = buffer;
		this._view = new DataView(
			buffer.buffer,
			buffer.byteOffset,
			buffer.byteLength,
		);
	}

	skip(amount = 1): void {
		const pos = this._pos;
		if (this._byte.length - pos < amount)
			throw new CborRangeError("Tried to read 1 byte beyond buffer bounds");
		this._pos = pos + amount;
	}

	peekUint8(): number {
		const pos = this._pos;
		if (this._byte.length - pos < 1)
			throw new CborRangeError("Tried to read 1 byte beyond buffer bounds");
		return this._view.getUint8(pos);
	}

	readUint8(): number {
		const pos = this._pos;
		if (this._byte.length - pos < 1)
			throw new CborRangeError("Tried to read 1 byte beyond buffer bounds");
		const val = this._view.getUint8(pos);
		this._pos = pos + 1;
		return val;
	}

	readUint16(): number {
		const pos = this._pos;
		if (this._byte.length - pos < 2)
			throw new CborRangeError("Tried to read 2 bytes beyond buffer bounds");
		const val = this._view.getUint16(pos);
		this._pos = pos + 2;
		return val;
	}

	readUint32(): number {
		const pos = this._pos;
		if (this._byte.length - pos < 4)
			throw new CborRangeError("Tried to read 4 bytes beyond buffer bounds");
		const val = this._view.getUint32(pos);
		this._pos = pos + 4;
		return val;
	}

	readUint64(): bigint {
		const pos = this._pos;
		if (this._byte.length - pos < 8)
			throw new CborRangeError("Tried to read 8 bytes beyond buffer bounds");
		const val = this._view.getBigUint64(pos);
		this._pos = pos + 8;
		return val;
	}

	readFloat16(): number {
		const val = this.readUint16();

		const sign = val & F16_SIGN_MASK ? -1 : 1;
		const exp = (val & F16_EXP_MASK) >> F16_EXP_SHIFT;
		const frac = val & F16_FRAC_MASK;

		if (exp === 0) {
			return sign * (frac / F16_FRAC_SCALE) * F16_SUBNORMAL_SCALE;
		}
		if (exp === F16_EXP_INF_NAN) {
			return frac ? Number.NaN : sign * Number.POSITIVE_INFINITY;
		}
		return sign * (1 + frac / F16_FRAC_SCALE) * FLOAT16_EXP_LUT[exp];
	}

	readFloat32(): number {
		const pos = this._pos;
		if (this._byte.length - pos < 4)
			throw new CborRangeError(
				"Tried to read 4 bytes for float32 beyond buffer bounds",
			);
		const val = this._view.getFloat32(pos);
		this._pos = pos + 4;
		return val;
	}

	readFloat64(): number {
		const pos = this._pos;
		if (this._byte.length - pos < 8)
			throw new CborRangeError(
				"Tried to read 8 bytes for float64 beyond buffer bounds",
			);
		const val = this._view.getFloat64(pos);
		this._pos = pos + 8;
		return val;
	}

	readBytes(amount: number): Uint8Array {
		const pos = this._pos;
		if (this._byte.length - pos < amount)
			throw new CborRangeError(`Tried to read ${amount} bytes beyond buffer`);
		this._pos = pos + amount;
		return this._byte.subarray(pos, this._pos);
	}

	readMajor(): [Major, number] {
		const byte = this.readUint8();
		const major = (byte >> 5) as Major;
		if (major < 0 || major > 7)
			throw new CborInvalidMajorError("Received invalid major type");
		return [major, byte & 0x1f];
	}

	readMajorLength(length: number): number | bigint {
		if (length <= 23) return length;
		if (length === 24) return this.readUint8();
		if (length === 25) return this.readUint16();
		if (length === 26) return this.readUint32();
		if (length === 27) {
			const read = this.readUint64();
			return read > POW_2_53 ? read : Number(read);
		}
		throw new CborRangeError("Expected a final length");
	}
}
