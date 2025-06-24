import type { AnyRecordId } from "../types";
import { jsonify } from "../utils";
import { RecordId, StringRecordId } from "../value";
import { isAnyRecordId } from "./validation";

export type Output<T, S> = S extends AnyRecordId ? T : T[];

/** @deprecated */
export function output<T, S>(subject: S, input: T | T[]): Output<T, S> {
	if (subject instanceof RecordId || subject instanceof StringRecordId) {
		return (Array.isArray(input) ? input[0] : input) as Output<T, S>;
	}

	return (Array.isArray(input) ? input : [input]) as Output<T, S>;
}

export interface ProcessOptions {
	subject?: unknown;
	json?: boolean;
}

export function collect<R, I = unknown>(
	input: I | I[],
	options: ProcessOptions,
): R {
	let data: unknown = input;

	if (options.subject) {
		if (isAnyRecordId(options.subject)) {
			data = Array.isArray(input) ? input[0] : input;
		} else {
			data = Array.isArray(input) ? input : [input];
		}
	}

	if (options.json) {
		data = jsonify(data);
	}

	return data as R;
}
