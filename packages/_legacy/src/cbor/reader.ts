import { type Major, POW_2_53 } from "./constants";
import { CborInvalidMajorError, CborRangeError } from "./error";

export class Reader {
	private _buf: ArrayBufferLike;
	private _view: DataView;
	private _byte: Uint8Array;
	private _pos = 0;

	constructor(buffer: ArrayBufferLike) {
		this._buf = new ArrayBuffer(buffer.byteLength);
		this._view = new DataView(this._buf);
		this._byte = new Uint8Array(this._buf);
		this._byte.set(new Uint8Array(buffer));
	}

	private read<T>(amount: number, res: T): T {
		this._pos += amount;
		return res;
	}

	readUint8(): number {
		try {
			return this.read(1, this._view.getUint8(this._pos));
		} catch (e) {
			if (e instanceof RangeError) throw new CborRangeError(e.message);
			throw e;
		}
	}

	readUint16(): number {
		try {
			return this.read(2, this._view.getUint16(this._pos));
		} catch (e) {
			if (e instanceof RangeError) throw new CborRangeError(e.message);
			throw e;
		}
	}

	readUint32(): number {
		try {
			return this.read(4, this._view.getUint32(this._pos));
		} catch (e) {
			if (e instanceof RangeError) throw new CborRangeError(e.message);
			throw e;
		}
	}

	readUint64(): bigint {
		try {
			return this.read(8, this._view.getBigUint64(this._pos));
		} catch (e) {
			if (e instanceof RangeError) throw new CborRangeError(e.message);
			throw e;
		}
	}

	// https://stackoverflow.com/a/5684578
	readFloat16(): number {
		const bytes = this.readUint16();
		const s = (bytes & 0x8000) >> 15;
		const e = (bytes & 0x7c00) >> 10;
		const f = bytes & 0x03ff;

		if (e === 0) {
			return (s ? -1 : 1) * 2 ** -14 * (f / 2 ** 10);
		}

		if (e === 0x1f) {
			return f ? Number.NaN : (s ? -1 : 1) * Number.POSITIVE_INFINITY;
		}

		return (s ? -1 : 1) * 2 ** (e - 15) * (1 + f / 2 ** 10);
	}

	readFloat32(): number {
		try {
			return this.read(4, this._view.getFloat32(this._pos));
		} catch (e) {
			if (e instanceof RangeError) throw new CborRangeError(e.message);
			throw e;
		}
	}

	readFloat64(): number {
		try {
			return this.read(8, this._view.getFloat64(this._pos));
		} catch (e) {
			if (e instanceof RangeError) throw new CborRangeError(e.message);
			throw e;
		}
	}

	readBytes(amount: number): Uint8Array {
		const available = this._byte.length - this._pos;
		if (available < amount)
			throw new CborRangeError(
				`The argument must be between 0 and ${available}`,
			);

		return this.read(amount, this._byte.slice(this._pos, this._pos + amount));
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

		switch (length) {
			case 24:
				return this.readUint8();
			case 25:
				return this.readUint16();
			case 26:
				return this.readUint32();
			case 27: {
				const read = this.readUint64();
				return read > POW_2_53 ? read : Number(read);
			}
		}

		throw new CborRangeError("Expected a final length");
	}
}
