export class SurrealDbError extends Error {}

export class NoActiveSocket extends SurrealDbError {
	name = "NoActiveSocket";
	message =
		"No socket is currently connected to a SurrealDB instance. Please call the .connect() method first!";
}

export class NoConnectionDetails extends SurrealDbError {
	name = "NoConnectionDetails";
	message =
		"No connection details for the HTTP api have been provided. Please call the .connect() method first!";
}

export class UnexpectedResponse extends SurrealDbError {
	name = "UnexpectedResponse";
	message =
		"The returned response from the SurrealDB instance is in an unexpected format. Unable to process response!";
}

export class InvalidURLProvided extends SurrealDbError {
	name = "InvalidURLProvided";
	message =
		"The provided string is either not a URL or is a URL but with an invalid protocol!";
}

export class NoURLProvided extends SurrealDbError {
	name = "NoURLProvided";
	message =
		"Tried to establish a connection while no connection URL was provided";
}

export class EngineDisconnected extends SurrealDbError {
	name = "EngineDisconnected";
	message = "The engine reported the connection to SurrealDB has dropped";
}

export class ReconnectFailed extends SurrealDbError {
	name = "ReconnectFailed";
	message = "The engine failed to reconnect to SurrealDB";
}

export class UnexpectedServerResponse extends SurrealDbError {
	name = "UnexpectedServerResponse";

	constructor(public readonly response: unknown) {
		super();
		this.message = `${response}`;
	}
}

export class UnexpectedConnectionError extends SurrealDbError {
	name = "UnexpectedConnectionError";

	constructor(public readonly error: unknown) {
		super();
		this.message = `${error}`;
	}
}

export class UnsupportedEngine extends SurrealDbError {
	name = "UnsupportedEngine";
	message =
		"The engine you are trying to connect to is not supported or configured.";

	constructor(public readonly engine: string) {
		super();
	}
}

export class FeatureUnavailableForEngine extends SurrealDbError {
	name = "FeatureUnavailableForEngine";
	message =
		"The feature you are trying to use is not available on this engine.";
}

export class ConnectionUnavailable extends SurrealDbError {
	name = "ConnectionUnavailable";
	message = "There is no connection available at this moment.";
}

export class MissingNamespaceDatabase extends SurrealDbError {
	name = "MissingNamespaceDatabase";
	message = "There is no namespace and/or database selected.";
}

export class HttpConnectionError extends SurrealDbError {
	name = "HttpConnectionError";

	constructor(
		public readonly message: string,
		public readonly status: number,
		public readonly statusText: string,
		public readonly buffer: ArrayBuffer,
	) {
		super();
	}
}

export class ResponseError extends SurrealDbError {
	name = "ResponseError";

	constructor(public readonly message: string) {
		super();
	}
}

export class NoNamespaceSpecified extends SurrealDbError {
	name = "NoNamespaceSpecified";
	message = "Please specify a namespace to use.";
}

export class NoDatabaseSpecified extends SurrealDbError {
	name = "NoDatabaseSpecified";
	message = "Please specify a database to use.";
}

export class NoTokenReturned extends SurrealDbError {
	name = "NoTokenReturned";
	message = "Did not receive an authentication token.";
}

export class UnsupportedVersion extends SurrealDbError {
	name = "UnsupportedVersion";
	version: string;
	supportedRange: string;

	constructor(version: string, supportedRange: string) {
		super();
		this.version = version;
		this.supportedRange = supportedRange;
		this.message = `The version "${version}" reported by the engine is not supported by this library, expected a version that satisfies "${supportedRange}".`;
	}
}

export class VersionRetrievalFailure extends SurrealDbError {
	name = "VersionRetrievalFailure";
	message =
		"Failed to retrieve remote version. If the server is behind a proxy, make sure it's configured correctly.";

	constructor(readonly error?: Error | undefined) {
		super();
	}
}
