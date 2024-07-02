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

	get left(): Uint8Array {
		return this._byte.slice(this._pos);
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

	// https://stackoverflow.com/a/8796597
	readFloat16(): number {
		const bytes = this.readUint16();
		const exponent = (bytes & 0x7c00) >> 10;
		const fraction = bytes & 0x03ff;
		const sign = bytes >> 15 ? -1 : 1;

		return (
			sign *
			(exponent
				? exponent === 0x1f
					? fraction
						? Number.NaN
						: Number.POSITIVE_INFINITY
					: (2 ** exponent - 15) * (1 + fraction / 0x400)
				: 6.103515625e-5 * (fraction / 0x400))
		);
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
		const available = this.left.length;
		if (amount > available)
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
