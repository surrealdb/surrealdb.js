export class AuthenticationError extends Error {
	name = "AuthenticationError";
}

export class PermissionError extends Error {
	name = "PermissionError";
}

export class RecordError extends Error {
	name = "RecordError";
}

export default {
	AuthenticationError: AuthenticationError,
	PermissionError: PermissionError,
	RecordError: RecordError,
};
