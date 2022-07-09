export class AuthenticationError extends Error {
	constructor(message) {
		super(message);
		this.name = "AuthenticationError";
	}
}

export class PermissionError extends Error {
	constructor(message) {
		super(message);
		this.name = "PermissionError";
	}
}

export class RecordError extends Error {
	constructor(message) {
		super(message);
		this.name = "RecordError";
	}
}

export default {
	AuthenticationError: AuthenticationError,
	PermissionError: PermissionError,
	RecordError: RecordError,
}
