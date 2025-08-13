import { Gap } from "@surrealdb/cbor";
import { PreparedQuery } from "./prepared-query.ts";

/**
 * A template literal tag function for creating prepared queries from query strings.
 * Interpolated values are automatically stored as bindings.
 * @param query_raw - The raw query string
 * @param values - The interpolated values
 * @example const query = surrealql`SELECT * FROM ${id}`;
 * @returns A PreparedQuery instance
 */
export function surrealql(
    rawQuery: string[] | TemplateStringsArray,
    ...values: unknown[]
): PreparedQuery {
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

        return [`bind___${i - reused}`, v] as const;
    });

    const bindings = mapped_bindings.reduce<Record<`bind___${number}`, unknown>>((prev, [k, v]) => {
        prev[k] = v;
        return prev;
    }, {});

    const query = rawQuery
        .flatMap((segment, i) => {
            const variable = mapped_bindings[i]?.[0];
            return [segment, ...(variable ? [`$${variable}`] : [])];
        })
        .join("");

    return new PreparedQuery(query, bindings);
}

export { surrealql as surql };
