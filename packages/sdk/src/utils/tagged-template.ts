import { getIncrementalID } from "../internal/get-incremental-id";
import { isExpression } from "../internal/validation";
import { BoundQuery, mergeBindings } from "./bound-query";
import { expr } from "./expr";

/**
 * A template literal tag function for creating BoundQuery instances from query strings.
 * Interpolated values are automatically stored as bindings with unique names.
 *
 * The result type can be specified to type the rows the query returns,
 * e.g. `surql<[User[]]>` for a query whose first statement yields `User[]`.
 *
 * @param strings The template string segments
 * @param values The interpolated values
 * @example const query = surql`SELECT * FROM users WHERE name = ${name}`;
 * @example const query = surql<[User[]]>`SELECT * FROM user`;
 * @returns A BoundQuery instance
 */
export function surql<R extends unknown[] = unknown[]>(
    strings: TemplateStringsArray,
    ...values: unknown[]
): BoundQuery<R> {
    const bindings: Record<string, unknown> = {};
    let result = "";

    for (let i = 0; i < strings.length; i++) {
        result += strings[i];
        if (i < values.length) {
            const value = values[i];

            if (value instanceof BoundQuery) {
                result += (value as unknown as BoundQuery).query;
                mergeBindings(bindings, (value as unknown as BoundQuery).bindings);
            } else if (isExpression(value)) {
                const built = expr(value);
                result += built.query;
                mergeBindings(bindings, built.bindings);
            } else {
                const bindingName = `bind__${getIncrementalID()}`;
                result += `$${bindingName}`;
                bindings[bindingName] = value;
            }
        }
    }

    return new BoundQuery<R>(result, bindings);
}
