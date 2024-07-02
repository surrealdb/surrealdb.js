import type { Major, Replacer } from "./constants";
import type { Gap } from "./gap";
import { PartiallyEncoded } from "./partial";

export class Writer {
	private _chunks: [ArrayBuffer, Gap][] = [];
	private _buf: ArrayBuffer;
	private _view: DataView;
	private _byte: Uint8Array;

	constructor() {
		this._buf = new ArrayBuffer(0);
		this._view = new DataView(this._buf);
		this._byte = new Uint8Array(this._buf);
	}

	chunk(gap: Gap): void {
		this._chunks.push([this._buf, gap]);
		this._buf = new ArrayBuffer(0);
		this._view = new DataView(this._buf);
		this._byte = new Uint8Array(this._buf);
	}

	get chunks(): [ArrayBuffer, Gap][] {
		return this._chunks;
	}

	get buffer(): ArrayBuffer {
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

	writeUint8(value: number): void {
		const pos = this.claim(1);
		this._view.setUint8(pos, value);
	}

	writeUint16(value: number): void {
		const pos = this.claim(2);
		this._view.setUint16(pos, value);
	}

	writeUint32(value: number): void {
		const pos = this.claim(4);
		this._view.setUint32(pos, value);
	}

	writeUint64(value: bigint): void {
		const pos = this.claim(8);
		this._view.setBigUint64(pos, value);
	}

	writeUint8Array(data: Uint8Array): void {
		if (data.byteLength === 0) return;
		const pos = this.claim(data.byteLength);
		this._byte.set(data, pos);
	}

	writeArrayBuffer(data: ArrayBuffer): void {
		if (data.byteLength === 0) return;
		this.writeUint8Array(new Uint8Array(data));
	}

	writePartiallyEncoded(data: PartiallyEncoded): void {
		for (const [buf, gap] of data.chunks) {
			this.writeArrayBuffer(buf);
			this.chunk(gap);
		}

		this.writeArrayBuffer(data.end);
	}

	writeFloat32(value: number): void {
		const pos = this.claim(4);
		this._view.setFloat32(pos, value);
	}

	writeFloat64(value: number): void {
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

	output<Partial extends boolean = false>(
		partial: Partial,
		replacer?: Replacer,
	): Partial extends true ? PartiallyEncoded : ArrayBuffer {
		if (partial) {
			return new PartiallyEncoded(
				this._chunks,
				this._buf,
				replacer,
			) as Partial extends true ? PartiallyEncoded : ArrayBuffer;
		}

		return this._buf as Partial extends true ? PartiallyEncoded : ArrayBuffer;
	}
}
