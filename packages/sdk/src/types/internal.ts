export type Prettify<T> = { [K in keyof T]: T[K] } & {};
export type Field<I> = keyof I | (string & {});
export type Selection = "value" | "fields" | "diff";
