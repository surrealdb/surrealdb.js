import { Gap } from "../cbor/gap.ts";
import { PreparedQuery } from "./prepared-query.ts";

export function surrealql(
	query_raw: string[] | TemplateStringsArray,
	...values: unknown[]
): PreparedQuery {
	const gaps = new Map<Gap, number>();
	const mapped_bindings = values.map((v, i) => {
		if (v instanceof Gap) {
			const index = gaps.get(v);
			if (index !== undefined) {
				return [`bind___${index}`, v] as const;
			}

			gaps.set(v, i);
		}

		return [`bind___${i}`, v] as const;
	});

	const bindings = mapped_bindings.reduce<Record<`bind___${number}`, unknown>>(
		(prev, [k, v]) => {
			prev[k] = v;
			return prev;
		},
		{},
	);

	const query = query_raw
		.flatMap((segment, i) => {
			const variable = mapped_bindings[i]?.[0];
			return [segment, ...(variable ? [`$${variable}`] : [])];
		})
		.join("");

	return new PreparedQuery(query, bindings);
}

export { surrealql as surql };
