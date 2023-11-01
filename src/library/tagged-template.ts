import { PreparedQuery } from "./PreparedQuery.ts";

export function surrealql(query_raw: string[], ...values: unknown[]) {
	const mapped_bindings = values.map((v, i) =>
		[`__tagged_template_literal_binding__${i}`, v] as const
	);
	const bindings = mapped_bindings.reduce((prev, [k, v]) => ({
		...prev,
		[k]: v,
	}), {});

	const query = query_raw
		.flatMap((segment, i) => {
			const variable = mapped_bindings[i]?.[0];
			return [
				segment,
				...(variable ? [`$${variable}`] : []),
			];
		})
		.join("");

	return new PreparedQuery(query, bindings);
}

export { surrealql as surql };
