import { markSymbol, SURREAL_ERROR_SYMBOL } from "./utils/symbols.ts";

export class SurrealError extends Error {
    constructor(message?: string, options?: ErrorOptions) {
        super(message, options);
        markSymbol(this, SURREAL_ERROR_SYMBOL);
    }
}

/**
 * Thrown when a parsed date or datetime is invalid
 */
export class InvalidDateError extends SurrealError {
    override name = "InvalidDateError";

    constructor(dateOrMessage: Date | string) {
        if (typeof dateOrMessage === "string") {
            super(dateOrMessage);
        } else {
            super(`The provided date is invalid: ${dateOrMessage}`);
        }
    }
}

/**
 * Thrown when a RecordId or RecordIdRange is constructed with invalid parts
 */
export class InvalidRecordIdError extends SurrealError {
    override name = "InvalidRecordIdError";
}

/**
 * Thrown when a Duration string cannot be parsed or a duration operation is invalid
 */
export class InvalidDurationError extends SurrealError {
    override name = "InvalidDurationError";
}

/**
 * Thrown when a Decimal operation fails (division by zero, invalid input, etc.)
 */
export class InvalidDecimalError extends SurrealError {
    override name = "InvalidDecimalError";
}

/**
 * Thrown when a Table or StringRecordId is constructed with an invalid value
 */
export class InvalidTableError extends SurrealError {
    override name = "InvalidTableError";
}
