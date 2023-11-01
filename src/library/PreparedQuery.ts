export class PreparedQuery {
	public readonly query: string = '';
	public readonly bindings: Record<string, unknown> = {};

	constructor(query: string, bindings?: Record<string, unknown>) {
		this.query = query;
		if (bindings) this.bindings = bindings;
	}
}
