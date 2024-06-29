import type { Major } from "./constants";

export class Writer {
	private _buf: ArrayBuffer;
	private _view: DataView;
	private _byte: Uint8Array;

	constructor() {
		this._buf = new ArrayBuffer(0);
		this._view = new DataView(this._buf);
		this._byte = new Uint8Array(this._buf);
	}

	get buffer() {
		return this._buf;
	}

	private claim(length: number) {
		const pos = this._buf.byteLength;
		const oldb = this._byte;
		this._buf = new ArrayBuffer(pos + length);
		this._view = new DataView(this._buf);
		this._byte = new Uint8Array(this._buf);
		this._byte.set(oldb);
		return pos;
	}

	writeUint8(value: number) {
		const pos = this.claim(1);
		this._view.setUint8(pos, value);
	}

	writeUint16(value: number) {
		const pos = this.claim(2);
		this._view.setUint16(pos, value);
	}

	writeUint32(value: number) {
		const pos = this.claim(4);
		this._view.setUint32(pos, value);
	}

	writeUint64(value: bigint) {
		const pos = this.claim(8);
		this._view.setBigUint64(pos, value);
	}

	writeUint8Array(data: Uint8Array) {
		const pos = this.claim(data.byteLength);
		this._byte.set(data, pos);
	}

	writeFloat32(value: number) {
		const pos = this.claim(4);
		this._view.setFloat32(pos, value);
	}

	writeFloat64(value: number) {
		const pos = this.claim(8);
		this._view.setFloat64(pos, value);
	}

	writeMajor(type: Major, length: number | bigint): void {
		const base = type << 5;
		if (length < 24) {
			this.writeUint8(base + Number(length));
		} else if (length < 0x100) {
			this.writeUint8(base + 24);
			this.writeUint8(Number(length));
		} else if (length < 0x10000) {
			this.writeUint8(base + 25);
			this.writeUint16(Number(length));
		} else if (length < 0x100000000) {
			this.writeUint8(base + 26);
			this.writeUint32(Number(length));
		} else {
			this.writeUint8(base + 27);
			this.writeUint64(BigInt(length));
		}
	}
}
