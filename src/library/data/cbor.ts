import { TaggedValue, encode as encode_cbor, decode as decode_cbor } from "cbor-redux";
import { RecordId } from "./recordid.ts";
import { Uuid } from "./uuid.ts";
import { Duration } from "./duration.ts";
import { Decimal } from "./decimal.ts"

export function encode<T extends unknown>(data: T) {
	return encode_cbor<T>(data, (_, v) => {
		if (v instanceof Date)     return new TaggedValue(v.toISOString(), 0);
		if (v === undefined)       return new TaggedValue(null,            6);
		if (v instanceof Uuid)     return new TaggedValue(v.uuid,          7);
		if (v instanceof Decimal)  return new TaggedValue(v.toString(),    8);
		if (v instanceof Duration) return new TaggedValue(v.toString(),    9);
		if (v instanceof RecordId) return new TaggedValue([v.tb, v.id],    10);
		return v;
	});
}

export function decode(data: ArrayBuffer) {
	return decode_cbor(data, (_, v) => {
		if (v instanceof TaggedValue) {
			if (v.tag === 0) return new Date(v.value);
			if (v.tag === 6) return undefined;
			if (v.tag === 7) return new Uuid(v.value);
			if (v.tag === 8) return new Decimal(v.value);
			if (v.tag === 9) return new Duration(v.value);
			if (v.tag === 10) return new RecordId(v.value[0], v.value[1]);
		}
		return v;
	});
}
