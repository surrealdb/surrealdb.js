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

export function createDisplayUtils() {
	const [variables, v] = createVariableStore();

	return {
		variables,
		utils: {
			var: v
		} satisfies DisplayUtils
	}
}

export type DisplayUtils = {
	var: (value: unknown) => string;
};
