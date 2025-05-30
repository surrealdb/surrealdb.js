import type { AnyRecordId } from "../types";
import { RecordId, StringRecordId } from "../value";

export type Output<T, S> = S extends AnyRecordId ? T : T[];

export function output<T, S>(subject: S, input: T | T[]): Output<T, S> {
	if (subject instanceof RecordId || subject instanceof StringRecordId) {
		return (Array.isArray(input) ? input[0] : input) as Output<T, S>;
	}

	return (Array.isArray(input) ? input : [input]) as Output<T, S>;
}
