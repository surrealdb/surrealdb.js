import { POW_2_53, POW_2_64, type Replacer } from "./constants";
import { Encoded } from "./encoded";
import { CborNumberError, CborPartialDisabled } from "./error";
import { type Fill, Gap } from "./gap";
import { PartiallyEncoded } from "./partial";
import { Tagged } from "./tagged";
import { Writer } from "./writer";

interface EncoderOptions<Partial extends boolean> {
	replacer?: Replacer;
	writer?: Writer;
	partial?: Partial;
	fills?: Fill[];
}

export function encode<Partial extends boolean = false>(
	input: unknown,
	options: EncoderOptions<Partial> = {},
): Partial extends true ? PartiallyEncoded : ArrayBuffer {
	const w = options.writer ?? new Writer();
	const value = options.replacer ? options.replacer(input) : input;
	const encodeOptions = { ...options, writer: w };
	const fillsMap = new Map(options.fills ?? []);

	if (value === undefined) {
		w.writeUint8(0xf7);
	} else if (value === null) {
		w.writeUint8(0xf6);
	} else if (value === true) {
		w.writeUint8(0xf5);
	} else if (value === false) {
		w.writeUint8(0xf4);
	} else if (value instanceof Gap) {
		if (fillsMap.has(value)) {
			encode(fillsMap.get(value), encodeOptions);
		} else {
			if (!options.partial) throw new CborPartialDisabled();
			w.chunk(value);
		}
	} else if (value instanceof PartiallyEncoded) {
		const res = value.build<Partial>(options.fills ?? [], options.partial);
		if (options.partial) {
			w.writePartiallyEncoded(res as PartiallyEncoded);
		} else {
			w.writeArrayBuffer(res as ArrayBuffer);
		}
	} else if (value instanceof Encoded) {
		w.writeArrayBuffer(value.encoded);
	} else {
		switch (typeof value) {
			case "number": {
				if (Number.isInteger(value)) {
					if (value >= 0 && value <= POW_2_53) {
						w.writeMajor(0, value);
					} else if (value < 0 && value >= -POW_2_53) {
						w.writeMajor(1, -(value + 1));
					} else {
						throw new CborNumberError("Number too big to be encoded");
					}
				} else {
					// Better precision when encoded as 64-bit
					w.writeUint8(0xfb);
					w.writeFloat64(value);
				}

				break;
			}

			case "bigint": {
				if (value >= 0 && value < POW_2_64) {
					w.writeMajor(0, value);
				} else if (value <= 0 && value >= -POW_2_64) {
					w.writeMajor(1, -(value + 1n));
				} else {
					throw new CborNumberError("BigInt too big to be encoded");
				}

				break;
			}

			case "string": {
				const textEncoder = new TextEncoder();
				const encoded = textEncoder.encode(value);
				w.writeMajor(3, encoded.byteLength);
				w.writeUint8Array(encoded);
				break;
			}

			default: {
				if (Array.isArray(value)) {
					w.writeMajor(4, value.length);
					for (const v of value) {
						encode(v, encodeOptions);
					}
				} else if (value instanceof Tagged) {
					w.writeMajor(6, value.tag);
					encode(value.value, encodeOptions);
				} else if (
					value instanceof Uint8Array ||
					value instanceof Uint16Array ||
					value instanceof Uint32Array ||
					value instanceof Int8Array ||
					value instanceof Int16Array ||
					value instanceof Int32Array ||
					value instanceof Float32Array ||
					value instanceof Float64Array ||
					value instanceof ArrayBuffer
				) {
					const v = new Uint8Array(value);
					w.writeMajor(2, v.byteLength);
					w.writeUint8Array(v);
				} else {
					const entries =
						value instanceof Map
							? Array.from(value.entries())
							: Object.entries(value);

					w.writeMajor(5, entries.length);
					for (const v of entries.flat()) {
						encode(v, encodeOptions);
					}
				}

				break;
			}
		}
	}

	return w.output<Partial>(!!options.partial as Partial, options.replacer);
}
