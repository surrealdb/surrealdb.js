import { RecordId } from "./cbor/recordid.ts";

/**
 * Recursively converts CBOR class instances into a JavaScript object format.
 *
 * @param {T} obj - The object or array to be flattened to a JavaScript object.
 * @return {T} The flattened JavaScript object or array.
 */
export function flatten<T>(obj: T): T {
	if (Array.isArray(obj)) {
		return obj.map(flatten) as unknown as T;
	} else if (obj !== null && typeof obj === "object") {
		if (obj instanceof RecordId) {
			return obj.toJSON() as unknown as T;
		}

		const flat = {} as T;
		for (const key in obj) {
			// deno-lint-ignore no-explicit-any
			(flat as any)[key] = flatten((obj as any)[key]);
		}

		return flat;
	}

	return obj;
}
