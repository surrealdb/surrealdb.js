// biome-ignore lint/suspicious/noExplicitAny: We don't know what it will return
export type Replacer = (v: any) => unknown;
export type Major = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7;
export const POW_2_53: number = 2 ** 53;
export const POW_2_64: bigint = BigInt(2 ** 64);
