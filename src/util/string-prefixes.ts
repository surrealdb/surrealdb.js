import { StringRecordId, Uuid } from "../data";

export function s(
	string: string[] | TemplateStringsArray,
	...values: unknown[]
): string {
	return string.reduce(
		(prev, curr, i) => `${prev}${curr}${values[i] ?? ""}`,
		"",
	);
}

export function d(
	string: string[] | TemplateStringsArray,
	...values: unknown[]
): Date {
	return new Date(s(string, values));
}

export function r(
	string: string[] | TemplateStringsArray,
	...values: unknown[]
): StringRecordId {
	return new StringRecordId(s(string, values));
}

export function u(
	string: string[] | TemplateStringsArray,
	...values: unknown[]
): Uuid {
	return new Uuid(s(string, values));
}
