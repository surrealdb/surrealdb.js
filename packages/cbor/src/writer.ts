import type { Major, Replacer } from "./constants";
import type { Gap } from "./gap";
import { PartiallyEncoded } from "./partial";

export class Writer {
    private _chunks: [Uint8Array, Gap][] = [];
    private _pos = 0;
    private _buf: ArrayBuffer;
    private _view: DataView;
    private _byte: Uint8Array;

    constructor(readonly byteLength = 256) {
        this._buf = new ArrayBuffer(this.byteLength);
        this._view = new DataView(this._buf);
        this._byte = new Uint8Array(this._buf);
    }

    chunk(gap: Gap): void {
        this._chunks.push([this._byte.subarray(0, this._pos), gap]);
        this._buf = new ArrayBuffer(this.byteLength);
        this._view = new DataView(this._buf);
        this._byte = new Uint8Array(this._buf);
        this._pos = 0;
    }

    get chunks(): [Uint8Array, Gap][] {
        return this._chunks;
    }

    get buffer(): Uint8Array {
        return this._byte.subarray(0, this._pos);
    }

    private claim(length: number): number {
        const pos = this._pos;
        this._pos += length;

        if (this._pos <= this._buf.byteLength) return pos;

        // Resize with exponential growth
        let newLen = this._buf.byteLength << 1;
        while (newLen < this._pos) newLen <<= 1;

        const oldb = this._byte;
        this._buf = new ArrayBuffer(newLen);
        this._view = new DataView(this._buf);
        this._byte = new Uint8Array(this._buf);
        this._byte.set(oldb);

        return pos;
    }

    writeUint8(value: number): void {
        const pos = this.claim(1);
        this._byte[pos] = value;
    }

    writeUint16(value: number): void {
        const pos = this.claim(2);
        this._view.setUint16(pos, value, false);
    }

    writeUint32(value: number): void {
        const pos = this.claim(4);
        this._view.setUint32(pos, value, false);
    }

    writeUint64(value: bigint): void {
        const pos = this.claim(8);
        this._view.setBigUint64(pos, value, false);
    }

    writeFloat32(value: number): void {
        const pos = this.claim(4);
        this._view.setFloat32(pos, value, false);
    }

    writeFloat64(value: number): void {
        const pos = this.claim(8);
        this._view.setFloat64(pos, value, false);
    }

    writeUint8Array(data: Uint8Array): void {
        if (data.byteLength === 0) return;
        const pos = this.claim(data.byteLength);
        this._byte.set(data, pos);
    }

    writePartiallyEncoded(data: PartiallyEncoded): void {
        for (const [buf, gap] of data.chunks) {
            this.writeUint8Array(buf);
            this.chunk(gap);
        }

        this.writeUint8Array(data.end);
    }

    writeMajor(type: Major, length: number | bigint): void {
        const base = type << 5;
        if (typeof length === "number") {
            if (length < 24) {
                this.writeUint8(base + length);
            } else if (length < 0x100) {
                this.writeUint8(base + 24);
                this.writeUint8(length);
            } else if (length < 0x10000) {
                this.writeUint8(base + 25);
                this.writeUint16(length);
            } else if (length < 0x100000000) {
                this.writeUint8(base + 26);
                this.writeUint32(length);
            } else {
                this.writeUint8(base + 27);
                this.writeUint64(BigInt(length));
            }
        } else {
            // bigint path
            if (length < 24n) {
                this.writeUint8(base + Number(length));
            } else if (length < 0x100n) {
                this.writeUint8(base + 24);
                this.writeUint8(Number(length));
            } else if (length < 0x10000n) {
                this.writeUint8(base + 25);
                this.writeUint16(Number(length));
            } else if (length < 0x100000000n) {
                this.writeUint8(base + 26);
                this.writeUint32(Number(length));
            } else {
                this.writeUint8(base + 27);
                this.writeUint64(length);
            }
        }
    }

    output(partial?: false, replacer?: Replacer): Uint8Array;
    output(partial: true, replacer?: Replacer): PartiallyEncoded;
    output(partial = false, replacer?: Replacer): Uint8Array | PartiallyEncoded {
        if (partial) {
            return new PartiallyEncoded(this._chunks, this.buffer, replacer);
        }
        return this.buffer;
    }
}
