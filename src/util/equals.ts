import { Value } from "../data/value";

/**
 * Recursively compare supported SurrealQL values for equality.
 *
 * @param x The first value to compare
 * @param y The second value to compare
 * @returns Whether the two values are recursively equal
 */
export function equals(x: unknown, y: unknown): boolean {
	if (Object.is(x, y)) return true;
	if (x instanceof Date && y instanceof Date) {
		return x.getTime() === y.getTime();
	}
	if (x instanceof RegExp && y instanceof RegExp) {
		return x.toString() === y.toString();
	}
	if (x instanceof Value && y instanceof Value) {
		return x.equals(y);
	}
	if (
		typeof x !== "object" ||
		x === null ||
		typeof y !== "object" ||
		y === null
	) {
		return false;
	}
	const keysX = Reflect.ownKeys(x as unknown as object) as (keyof typeof x)[];
	const keysY = Reflect.ownKeys(y as unknown as object);
	if (keysX.length !== keysY.length) return false;
	for (let i = 0; i < keysX.length; i++) {
		if (!Reflect.has(y as unknown as object, keysX[i])) return false;
		if (!equals(x[keysX[i]], y[keysX[i]])) return false;
	}
	return true;
}
