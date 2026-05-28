/**
 * The base error class for all SQON errors.
 */
export class SqonError extends Error {}

/**
 * Thrown when a parsed date or datetime is invalid
 */
export class InvalidDateError extends SqonError {
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
export class InvalidRecordIdError extends SqonError {
    override name = "InvalidRecordIdError";
}

/**
 * Thrown when a Duration string cannot be parsed or a duration operation is invalid
 */
export class InvalidDurationError extends SqonError {
    override name = "InvalidDurationError";
}

/**
 * Thrown when a Decimal operation fails (division by zero, invalid input, etc.)
 */
export class InvalidDecimalError extends SqonError {
    override name = "InvalidDecimalError";
}

/**
 * Thrown when a Table or StringRecordId is constructed with an invalid value
 */
export class InvalidTableError extends SqonError {
    override name = "InvalidTableError";
}
