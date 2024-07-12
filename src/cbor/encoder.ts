import { POW_2_53, POW_2_64, type Replacer } from "./constants";
import { Encoded } from "./encoded";
import { CborNumberError, CborPartialDisabled } from "./error";
import { type Fill, Gap } from "./gap";
import { PartiallyEncoded } from "./partial";
import { Tagged } from "./tagged";
import { Writer } from "./writer";

let textEncoder: TextEncoder;

export interface EncoderOptions<Partial extends boolean> {
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
	const fillsMap = new Map(options.fills ?? []);

	function inner(input: unknown) {
		const value = options.replacer ? options.replacer(input) : input;

		if (value === undefined) return w.writeUint8(0xf7);
		if (value === null) return w.writeUint8(0xf6);
		if (value === true) return w.writeUint8(0xf5);
		if (value === false) return w.writeUint8(0xf4);

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

				return;
			}

			case "bigint": {
				if (value >= 0 && value < POW_2_64) {
					w.writeMajor(0, value);
				} else if (value <= 0 && value >= -POW_2_64) {
					w.writeMajor(1, -(value + 1n));
				} else {
					throw new CborNumberError("BigInt too big to be encoded");
				}

				return;
			}

			case "string": {
				textEncoder ??= new TextEncoder();
				const encoded = textEncoder.encode(value);
				w.writeMajor(3, encoded.byteLength);
				w.writeUint8Array(encoded);
				return;
			}

			default: {
				if (Array.isArray(value)) {
					w.writeMajor(4, value.length);
					for (const v of value) {
						inner(v);
					}
					return;
				}

				if (value instanceof Tagged) {
					w.writeMajor(6, value.tag);
					inner(value.value);
					return;
				}

				if (value instanceof Encoded) {
					w.writeArrayBuffer(value.encoded);
					return;
				}

				if (value instanceof Gap) {
					if (fillsMap.has(value)) {
						inner(fillsMap.get(value));
					} else {
						if (!options.partial) throw new CborPartialDisabled();
						w.chunk(value);
					}

					return;
				}

				if (value instanceof PartiallyEncoded) {
					const res = value.build<Partial>(
						options.fills ?? [],
						options.partial,
					);
					if (options.partial) {
						w.writePartiallyEncoded(res as PartiallyEncoded);
					} else {
						w.writeArrayBuffer(res as ArrayBuffer);
					}

					return;
				}

				if (
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
					return;
				}

				const entries =
					value instanceof Map
						? Array.from(value.entries())
						: Object.entries(value);

				w.writeMajor(5, entries.length);
				for (const v of entries.flat()) {
					inner(v);
				}
			}
		}
	}

	inner(input);
	return w.output<Partial>(!!options.partial as Partial, options.replacer);
}
