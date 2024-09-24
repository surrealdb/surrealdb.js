import { PreparedQuery } from "./prepared-query.ts";

/**
 * Create a prepared query from a template string
 *
 * @param query_raw The template string
 * @param values Optional values to bind to the query
 * @returns A prepared query
 */
export function surrealql(
	query_raw: string[] | TemplateStringsArray,
	...values: unknown[]
): PreparedQuery {
	const mapped_bindings = values.map((v, i) => [`bind___${i}`, v] as const);
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
