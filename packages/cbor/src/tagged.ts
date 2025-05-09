export class Tagged<T = unknown> {
	constructor(
		readonly tag: number | bigint,
		readonly value: T,
	) {}
}
