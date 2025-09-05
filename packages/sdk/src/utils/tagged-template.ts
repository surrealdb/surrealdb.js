import { getIncrementalID } from "../internal/get-incremental-id";
import { isExpression } from "../internal/validation";
import { BoundQuery } from "./bound-query";
import { expr } from "./expr";

/**
 * A template literal tag function for creating BoundQuery instances from query strings.
 * Interpolated values are automatically stored as bindings with unique names.
 *
 * @param strings The template string segments
 * @param values The interpolated values
 * @example const query = surql`SELECT * FROM users WHERE name = ${name}`;
 * @returns A BoundQuery instance
 */
export function surql(strings: TemplateStringsArray, ...values: unknown[]): BoundQuery {
    const bindings: Record<string, unknown> = {};
    let result = "";

    for (let i = 0; i < strings.length; i++) {
        result += strings[i];
        if (i < values.length) {
            const value = values[i];

            if (isExpression(value)) {
                const built = expr(value);
                result += built.query;
                Object.assign(bindings, built.bindings);
            } else {
                const bindingName = `bind__${getIncrementalID()}`;
                result += `$${bindingName}`;
                bindings[bindingName] = value;
            }
        }
    }

    return new BoundQuery(result, bindings);
}
