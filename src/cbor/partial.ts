import type { Replacer } from "./constants";
import { encode } from "./encoder";
import { CborFillMissing } from "./error";
import type { Fill, Gap } from "./gap";
import { Writer } from "./writer";

export class PartiallyEncoded {
	constructor(
		readonly chunks: [ArrayBuffer, Gap][],
		readonly end: ArrayBuffer,
		readonly replacer: Replacer | undefined,
	) {}

	build<Partial extends boolean = false>(
		fills: Fill[],
		partial?: Partial,
	): Partial extends true ? PartiallyEncoded : ArrayBuffer {
		const writer = new Writer();
		const map = new Map(fills);

		for (const [buffer, gap] of this.chunks) {
			const hasValue = map.has(gap) || gap.hasDefault();
			if (!partial && !hasValue) throw new CborFillMissing();
			writer.writeArrayBuffer(buffer);

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

		writer.writeArrayBuffer(this.end);
		return writer.output<Partial>(!!partial as Partial, this.replacer);
	}
}

export function partiallyEncodeObject(
	object: Record<string, unknown>,
	fills?: Fill[],
): Record<string, PartiallyEncoded> {
	return Object.fromEntries(
		Object.entries(object).map(([k, v]) => [
			k,
			encode(v, { fills, partial: true }),
		]),
	);
}
