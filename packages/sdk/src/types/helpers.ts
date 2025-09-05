import type { RecordId, StringRecordId } from "../value";
import type { Prettify } from "./internal";

export type Version = `${number}.${number}.${number}`;
export type Doc = Prettify<Record<string, unknown>>;
export type Values<T> = Partial<T> & Doc;
export type Output = "none" | "null" | "diff" | "before" | "after";
export type Mutation = "content" | "merge" | "replace" | "patch";

export type AnyRecordId<Tb extends string = string> = RecordId<Tb> | StringRecordId;

export type Nullish<T> = T | null | undefined;
