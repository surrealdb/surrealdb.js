import Surreal from "./index.ts";

type SURREAL_QUERY = string;

export function system() {
	type Payload = {
		ns: {
			[TNamespace in string]?: SURREAL_QUERY;
		};
	};
	return (surreal: Surreal) => surreal.query<Payload>("INFO FOR KV;");
}

export function namespace() {
	type Payload = {
		db: {
			[TDatabase in string]?: SURREAL_QUERY;
		};
		nl: unknown;
		nt: unknown;
	};

	return (surreal: Surreal) => surreal.query<Payload>("INFO FOR NS;");
}

export function database() {
	type Payload = {
		dl: unknown;
		dt: unknown;
		sc: unknown;
		tb: {
			[TTable in string]?: SURREAL_QUERY;
		};
	};
	return (surreal: Surreal) => surreal.query<Payload>("INFO FOR DB;");
}

export function scope(scope: string) {
	type Payload = {
		st: unknown;
	};
	return (surreal: Surreal) =>
		surreal.query<Payload>("INFO FOR SCOPE $scope;", { scope });
}

export function table(table: string) {
	type Payload = {
		ev: unknown;
		fd: unknown;
		ft: unknown;
		ix: unknown;
	};
	return (surreal: Surreal) =>
		surreal.query<Payload>("INFO FOR TABLE $table;", { table });
}
