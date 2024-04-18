export type ConvertMethod<T extends unknown = unknown> = (
	result: unknown[],
) => T;
export class PreparedQuery<
	C extends ConvertMethod | undefined = ConvertMethod,
> {
	public readonly query: string = "";
	public readonly bindings: Record<string, unknown> = {};
	public readonly convert?: C;

	constructor(
		query: string,
		bindings?: Record<string, unknown>,
		convert?: C,
	) {
		this.query = query;
		this.convert = convert;
		if (bindings) this.bindings = bindings;
	}
}
