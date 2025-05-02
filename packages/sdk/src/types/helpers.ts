import type { RecordId, StringRecordId } from "../value";

export type Version = `${number}.${number}.${number}`;
export type Params = Prettify<Record<string, unknown>>;

export type AnyRecordId<Tb extends string = string> =
	| RecordId<Tb>
	| StringRecordId;

export type Prettify<T> = {
	[K in keyof T]: T[K];
} & {};
