export function createVariableStore() {
	const variables: Record<string, unknown> = {};
	const v = (value: unknown) => {
		const num = Object.keys(variables).length;
		const name = `_v${num}`;
		variables[name] = value;
		return name;
	}

	return [variables, v] as const;
}

export function createDisplayUtils(upstream: Partial<DisplayUtils> = {}) {
	const [variables, v] = createVariableStore();

	return {
		var: v,
		variables,
		...upstream,
	} satisfies DisplayUtils;
}

export type DisplayUtils = {
	var: (value: unknown) => string;
	variables: Record<string, unknown>;
};
