import { POW_2_53, POW_2_64, type Replacer } from "./constants";
import { Encoded } from "./encoded";
import { CborNumberError, CborPartialDisabled } from "./error";
import { type Fill, Gap } from "./gap";
import { PartiallyEncoded } from "./partial";
import { Tagged } from "./tagged";
import { Writer } from "./writer";

const textEncoder = new TextEncoder();

export interface EncoderOptions<Partial extends boolean = boolean> {
	replacer?: Replacer;
	writer?: Writer;
	partial?: Partial;
	fills?: Fill[];
}

function encode(input: unknown, options?: EncoderOptions<false>): Uint8Array;
function encode(
	input: unknown,
	options?: EncoderOptions<true>,
): PartiallyEncoded;
function encode(
	input: unknown,
	options: EncoderOptions = {},
): PartiallyEncoded | Uint8Array {
	const w = options.writer ?? new Writer();
	const fillsMap = new Map(options.fills ?? []);

	function inner(input: unknown) {
		// biome-ignore lint/style/noParameterAssign:
		input = options.replacer?.(input) ?? input;

		if (input === undefined) return w.writeUint8(0xf7);
		if (input === null) return w.writeUint8(0xf6);
		if (input === true) return w.writeUint8(0xf5);
		if (input === false) return w.writeUint8(0xf4);

		switch (typeof input) {
			case "number": {
				if (Number.isInteger(input)) {
					if (input >= 0 && input <= POW_2_53) {
						w.writeMajor(0, input);
					} else if (input < 0 && input >= -POW_2_53) {
						w.writeMajor(1, -(input + 1));
					} else {
						throw new CborNumberError("Number too big to be encoded");
					}
				} else {
					// Better precision when encoded as 64-bit
					w.writeUint8(0xfb);
					w.writeFloat64(input);
				}

				return;
			}

			case "bigint": {
				if (input >= 0 && input < POW_2_64) {
					w.writeMajor(0, input);
				} else if (input <= 0 && input >= -POW_2_64) {
					w.writeMajor(1, -(input + 1n));
				} else {
					throw new CborNumberError("BigInt too big to be encoded");
				}

				return;
			}

			case "string": {
				const encoded = textEncoder.encode(input);
				w.writeMajor(3, encoded.byteLength);
				w.writeUint8Array(encoded);
				return;
			}

			default: {
				if (Array.isArray(input)) {
					w.writeMajor(4, input.length);
					for (const v of input) {
						inner(v);
					}
					return;
				}

				if (input instanceof Tagged) {
					w.writeMajor(6, input.tag);
					inner(input.value);
					return;
				}

				if (input instanceof Encoded) {
					w.writeUint8Array(input.encoded);
					return;
				}

				if (input instanceof Gap) {
					if (fillsMap.has(input)) {
						inner(fillsMap.get(input));
					} else {
						if (options.partial) {
							w.chunk(input);
						} else {
							throw new CborPartialDisabled();
						}
					}

					return;
				}

				if (input instanceof PartiallyEncoded) {
					const res = options.partial
						? input.build(options.fills ?? [], true)
						: input.build(options.fills ?? [], false);

					if (res instanceof PartiallyEncoded) {
						w.writePartiallyEncoded(res);
					} else {
						w.writeUint8Array(res);
					}

					return;
				}

				if (
					input instanceof Uint8Array ||
					input instanceof Uint16Array ||
					input instanceof Uint32Array ||
					input instanceof Int8Array ||
					input instanceof Int16Array ||
					input instanceof Int32Array ||
					input instanceof Float32Array ||
					input instanceof Float64Array ||
					input instanceof ArrayBuffer
				) {
					const v = input instanceof Uint8Array ? input : new Uint8Array(input);
					w.writeMajor(2, v.byteLength);
					w.writeUint8Array(v);
					return;
				}

				if (input instanceof Map) {
					w.writeMajor(5, input.size);
					for (const [k, v] of input) {
						inner(k);
						inner(v);
					}
				} else {
					const entries = Object.entries(input);
					w.writeMajor(5, entries.length);
					for (const [k, v] of entries) {
						inner(k);
						inner(v);
					}
				}
			}
		}
	}

	inner(input);

	if (options.partial) {
		return w.output(true, options.replacer);
	}

	return w.output(false, options.replacer);
}

export { encode };
