import type { RecordId, RecordIdValue, StringRecordId } from "../value";

export type Version = `${number}.${number}.${number}`;
export type Values<T> = Partial<T> & Record<string, unknown>;
export type Output = "none" | "null" | "diff" | "before" | "after";
export type Mutation = "content" | "merge" | "replace" | "patch";
export type Nullable<T> = { [K in keyof T]: T[K] | null };

export type AnyRecordId<Tb extends string = string, Id extends RecordIdValue = RecordIdValue> =
    | RecordId<Tb, Id>
    | StringRecordId;
