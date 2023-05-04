export class NoActiveSocket extends Error {
	name = "NoActiveSocket";
	message =
		"No socket is currently connected to a SurrealDB instance. Please call the .connect() method first!";
}

export class NoConnectionDetails extends Error {
	name = "NoConnectionDetails";
	message =
		"No connection details for the HTTP api have been provided. Please call the .connect() method first!";
}

export class UnexpectedResponse extends Error {
	name = "UnexpectedResponse";
	message =
		"The returned response from the SurrealDB instance is in an unexpected format. Unable to process response!";
}
