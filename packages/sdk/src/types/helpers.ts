import type { RecordId, StringRecordId } from "../value";
import type { Prettify } from "./internal";

export type Version = `${number}.${number}.${number}`;
export type Doc = Prettify<Record<string, unknown>>;

export type AnyRecordId<Tb extends string = string> = RecordId<Tb> | StringRecordId;

export type Nullish<T> = T | null | undefined;
