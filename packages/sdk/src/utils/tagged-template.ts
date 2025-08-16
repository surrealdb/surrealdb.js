import { BoundQuery } from "./bound-query";

let uniqueId = 0;

/**
 * A template literal tag function for creating BoundQuery instances from query strings.
 * Interpolated values are automatically stored as bindings with unique names.
 * 
 * @param strings The template string segments
 * @param expressions The interpolated values
 * @example const query = surql`SELECT * FROM users WHERE name = ${name}`;
 * @returns A BoundQuery instance
 */
export function surql(strings: TemplateStringsArray, ...expressions: unknown[]): BoundQuery {
	const id = uniqueId++;
	const bindings: Record<string, unknown> = {};
	let result = "";

	for (let i = 0; i < strings.length; i++) {
		result += strings[i];
		if (i < expressions.length) {
			const bindingName = `bind__${id}_${i}`;
			result += `$${bindingName}`;
			bindings[bindingName] = expressions[i];
		}
	}

	return new BoundQuery(result, bindings);
}
