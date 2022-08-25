class AuthenticationError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'AuthenticationError';
    }
}

class PermissionError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'PermissionError';
    }
}

class RecordError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'RecordError';
    }
}

export {
    AuthenticationError,
    PermissionError,
    RecordError,
}
