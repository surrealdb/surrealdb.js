import { UUID, uuidv4obj, uuidv7obj } from "uuidv7";

export class Uuid {
	private readonly inner: UUID;

	constructor(uuid: string | ArrayBuffer | Uint8Array | Uuid | UUID) {
		if (uuid instanceof ArrayBuffer) {
			this.inner = UUID.ofInner(new Uint8Array(uuid));
		} else if (uuid instanceof Uint8Array) {
			this.inner = UUID.ofInner(uuid);
		} else if (uuid instanceof Uuid) {
			this.inner = uuid.inner;
		} else if (uuid instanceof UUID) {
			this.inner = uuid;
		} else {
			this.inner = UUID.parse(uuid);
		}
	}

	toString(): string {
		return this.inner.toString();
	}

	toJSON(): string {
		return this.inner.toString();
	}

	toUint8Array(): Uint8Array {
		return this.inner.bytes;
	}

	toBuffer(): ArrayBufferLike {
		return this.inner.bytes.buffer;
	}

	static v4(): Uuid {
		return new Uuid(uuidv4obj());
	}

	static v7(): Uuid {
		return new Uuid(uuidv7obj());
	}
}
