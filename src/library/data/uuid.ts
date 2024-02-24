import { validate, v4 } from 'uuid';

export class Uuid {
	public readonly uuid: string;

	constructor(uuid?: string) {
		uuid ??= v4();
		if (!validate(uuid)) throw new Error("Passed value is not a valid UUID");
		this.uuid = uuid;
	}
}
