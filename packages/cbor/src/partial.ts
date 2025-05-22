import type { Replacer } from "./constants";
import { type EncoderOptions, encode } from "./encoder";
import { CborFillMissing } from "./error";
import type { Fill, Gap } from "./gap";
import { Writer } from "./writer";

export class PartiallyEncoded {
	constructor(
		readonly chunks: [Uint8Array<ArrayBuffer>, Gap][],
		readonly end: Uint8Array<ArrayBuffer>,
		readonly replacer: Replacer | undefined,
	) {}

	build(fills: Fill[], partial?: false): Uint8Array<ArrayBuffer>;
	build(fills: Fill[], partial: true): PartiallyEncoded;
	build(
		fills: Fill[],
		partial?: boolean,
	): PartiallyEncoded | Uint8Array<ArrayBuffer> {
		const writer = new Writer();
		const map = new Map(fills);

		for (const [buffer, gap] of this.chunks) {
			const hasValue = map.has(gap) || gap.hasDefault();
			if (!partial && !hasValue) throw new CborFillMissing();
			writer.writeUint8Array(buffer);

			if (hasValue) {
				const data = map.get(gap) ?? gap.default;
				encode(data, {
					writer,
					replacer: this.replacer,
				});
			} else {
				writer.chunk(gap);
			}
		}

		writer.writeUint8Array(this.end);
		if (partial) {
			return writer.output(true, this.replacer);
		}

		return writer.output(false, this.replacer);
	}
}

export function partiallyEncodeObject(
	object: Record<string, unknown>,
	options?: EncoderOptions<true>,
): Record<string, PartiallyEncoded> {
	return Object.fromEntries(
		Object.entries(object).map(([k, v]) => [
			k,
			encode(v, { ...options, partial: true }),
		]),
	);
}
