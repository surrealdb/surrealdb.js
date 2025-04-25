import {
	encode,
	Encoded,
	Gap,
	partiallyEncodeObject,
	Writer,
	type Fill,
	type PartiallyEncoded,
} from "@surrealdb/cbor";
import { REPLACER } from "../cbor/replacer";

let textEncoder: TextEncoder;

/**
 * A query and its bindings prepared for execution, which can be passed to the .query() method.
 */
export class PreparedQuery {
	private _query: Uint8Array;
	private _bindings: Record<string, PartiallyEncoded>;
	private length: number;

	constructor(query: string, bindings?: Record<string, unknown>) {
		textEncoder ??= new TextEncoder();
		this._query = textEncoder.encode(query);
		this._bindings = partiallyEncodeObject(bindings ?? {}, {
			replacer: REPLACER.encode,
		});
		this.length = Object.keys(this._bindings).length;
	}

	/**
	 * Retrieves the encoded query string.
	 */
	get query(): Encoded {
		// Up to 9 bytes for the prefix
		const w = new Writer(this._query.byteLength + 9);
		w.writeMajor(3, this._query.byteLength);
		w.writeUint8Array(this._query);
		return new Encoded(w.output(false));
	}

	/**
	 * Retrieves the encoded bindings.
	 */
	get bindings(): Record<string, PartiallyEncoded> {
		return this._bindings;
	}

	/**
	 * Compile this query and its bindings into a single ArrayBuffer, optionally filling gaps.
	 * @param fills - The gap values to fill
	 */
	build(fills?: Fill[]): ArrayBuffer {
		return encode([this.query, this.bindings], { fills });
	}

	/**
	 * A template literal tag function for appending additional query segments and bindings to the prepared query.
	 * @param rawQuery - The additional query segments to append
	 * @param values - The additional interpolated values to append
	 * @example
	 * const query = surrealql`SELECT * FROM person`;
	 *
	 * if (filter) {
	 *   query.append` WHERE name = ${filter}`;
	 * }
	 */
	append(
		rawQuery: string[] | TemplateStringsArray,
		...values: unknown[]
	): PreparedQuery {
		const base = this.length;
		this.length += values.length;

		let reused = 0;
		const gaps = new Map<Gap, number>();
		const mapped_bindings = values.map((v, i) => {
			if (v instanceof Gap) {
				const index = gaps.get(v);
				if (index !== undefined) {
					reused++;
					return [`bind___${index}`, v] as const;
				}

				gaps.set(v, i - reused);
			}

			return [`bind___${base + i - reused}`, v] as const;
		});

		for (const [k, v] of mapped_bindings) {
			this._bindings[k] = encode(v, {
				replacer: REPLACER.encode,
				partial: true,
			});
		}

		const query = rawQuery
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
