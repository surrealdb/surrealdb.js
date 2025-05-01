export type Version = `${number}.${number}.${number}`;
export type Prettify<T> = {
	[K in keyof T]: T[K];
} & {};
