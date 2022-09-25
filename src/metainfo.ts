import Surreal from "./index.ts";

type SURREAL_QUERY = string;

/**
 * # System information
 * The top-level KV command returns information regarding the namespaces which exists within the SurrealDB system.
 * @note You must be authenticated as a top-level root user to execute this command.
 */
export function system() {
	type Payload = {
		ns: {
			[TNamespace in string]?: SURREAL_QUERY;
		};
	};
	return (surreal: Surreal) => surreal.query<Payload>("INFO FOR KV;");
}

/**
 * # Namespace information
 * The NS or NAMESPACE command returns information regarding the logins, tokens, and databases under a specific Namespace.
 * @note You must be authenticated as a top-level root user, or a namespace user to execute this command.
 * @note You must have a NAMESPACE selected before running this command.
 */
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

/**
 * # Database information
 * The DB or DATABASE command returns information regarding the logins, tokens, and scopes, and tables under a specific Database.
 * @note You must be authenticated as a top-level root user, a namespace user, or a database user to execute this command.
 * @note You must have a NAMESPACE and a DATABASE selected before running this command.
 */
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

/**
 * # Scope information
 * The SCOPE command returns information regarding the tokens configured under a specific Scope.
 * @note You must be authenticated as a top-level root user, a namespace user, or a database user to execute this command.
 * @note You must have a NAMESPACE and a DATABASE selected before running this command.
 */
export function scope(scope: string) {
	type Payload = {
		st: unknown;
	};
	return (surreal: Surreal) =>
		surreal.query<Payload>("INFO FOR SCOPE $scope;", { scope });
}

/**
 * # Table information
 * The TABLE command returns information regarding the events, fields, indexes, and foreign table configurations on a specific Table.
 * @note You must be authenticated as a top-level root user, a namespace user, or a database user to execute this command.
 * @note You must have a NAMESPACE and a DATABASE selected before running this command.
 */
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

export function listNamespaces() {
	return (surreal: Surreal) =>
		system()(surreal).then((e) => Object.keys(e.ns));
}

export function listDatabases() {
	return (surreal: Surreal) =>
		namespace()(surreal).then((e) => Object.keys(e.db));
}

export function listTables() {
	return (surreal: Surreal) =>
		database()(surreal).then((e) => Object.keys(e.tb));
}
