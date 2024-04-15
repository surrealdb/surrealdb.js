import { validate, v4 } from 'uuid';

export class Uuid {
	public readonly uuid: string;

	constructor(uuid?: string) {
		uuid ??= v4();
		if (!validate(uuid)) throw new Error("Passed value is not a valid UUID");
		this.uuid = uuid;
	}
}

function fromBytes(bytes: ArrayBuffer) {
    return Array.from(bytes)
		.map((b) => ('00' + b.toString(16)).slice(-2))
		.join('')
		.replace(/(.{8})(.{4})(.{4})(.{4})(.{12})/, '$1-$2-$3-$4-$5');
}

function toBytes(str: string) {
	return new Uint8Array((str.replace(/-/g, '').match(/.{2}/g) || []).map((b) =>
		parseInt(b, 16)
	)).buffer;
}
