import {
	Encoded,
	type Fill,
	type PartiallyEncoded,
	encode,
	partiallyEncodeObject,
} from "../cbor";
import { replacer } from "../data/cbor";

export type ConvertMethod<T = unknown> = (result: unknown[]) => T;
export class PreparedQuery<
	C extends ConvertMethod | undefined = ConvertMethod,
> {
	public readonly query: Encoded;
	public readonly bindings: Record<string, PartiallyEncoded>;

	constructor(query: string, bindings?: Record<string, unknown>, convert?: C) {
		this.query = new Encoded(encode(query));
		this.bindings = partiallyEncodeObject(bindings ?? {}, {
			replacer: replacer.encode,
		});
	}

	build(gaps?: Fill[]): ArrayBuffer {
		return encode([this.query, this.bindings]);
	}
}
