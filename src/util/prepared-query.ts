import {
	Encoded,
	type Fill,
	Gap,
	type PartiallyEncoded,
	Writer,
	encode,
	partiallyEncodeObject,
} from "../cbor";
import { replacer } from "../data/cbor";

let textEncoder: TextEncoder;

export type ConvertMethod<T = unknown> = (result: unknown[]) => T;
export class PreparedQuery {
	private _query: Uint8Array;
	private _bindings: Record<string, PartiallyEncoded>;
	private length: number;

	constructor(query: string, bindings?: Record<string, unknown>) {
		textEncoder ??= new TextEncoder();
		this._query = textEncoder.encode(query);
		this._bindings = partiallyEncodeObject(bindings ?? {}, {
			replacer: replacer.encode,
		});
		this.length = Object.keys(this._bindings).length;
	}

	get query(): Encoded {
		// Up to 9 bytes for the prefix
		const w = new Writer(this._query.byteLength + 9);
		w.writeMajor(3, this._query.byteLength);
		w.writeUint8Array(this._query);
		return new Encoded(w.output(false));
	}

	get bindings(): Record<string, PartiallyEncoded> {
		return this._bindings;
	}

	build(fills?: Fill[]): ArrayBuffer {
		return encode([this.query, this.bindings], { fills });
	}

	append(
		query_raw: string[] | TemplateStringsArray,
		...values: unknown[]
	): PreparedQuery {
		const base = this.length;
		this.length += values.length;
		const gaps = new Map<Gap, number>();
		const mapped_bindings = values.map((v, i) => {
			if (v instanceof Gap) {
				const index = gaps.get(v);
				if (index !== undefined) {
					return [`bind___${index}`, v] as const;
				}

				gaps.set(v, i);
			}

			return [`bind___${base + i}`, v] as const;
		});

		for (const [k, v] of mapped_bindings) {
			this._bindings[k] = encode(v, {
				replacer: replacer.encode,
				partial: true,
			});
		}

		const query = query_raw
			.flatMap((segment, i) => {
				const variable = mapped_bindings[i]?.[0];
				return [segment, ...(variable ? [`$${variable}`] : [])];
			})
			.join("");

		textEncoder ??= new TextEncoder();
		const current = new Uint8Array(this._query);
		const added = textEncoder.encode(query);
		this._query = new Uint8Array(current.byteLength + added.byteLength);
		this._query.set(current);
		this._query.set(added, current.byteLength);
		return this;
	}
}
