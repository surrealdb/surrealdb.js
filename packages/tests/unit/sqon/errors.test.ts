import { describe, expect, test } from "bun:test";
import {
    InvalidDateError,
    InvalidDecimalError,
    InvalidDurationError,
    InvalidRecordIdError,
    InvalidTableError,
    SqonError,
} from "surrealdb";

describe("SQON errors", () => {
    test("SqonError is the base error class", () => {
        const error = new SqonError("test");
        expect(error).toBeInstanceOf(Error);
        expect(error).toBeInstanceOf(SqonError);
        expect(error.message).toBe("test");
    });

    test("InvalidDateError accepts a message", () => {
        const error = new InvalidDateError("invalid datetime");
        expect(error).toBeInstanceOf(SqonError);
        expect(error.name).toBe("InvalidDateError");
        expect(error.message).toBe("invalid datetime");
    });

    test("InvalidDateError accepts an invalid Date", () => {
        const error = new InvalidDateError(new Date(NaN));
        expect(error).toBeInstanceOf(SqonError);
        expect(error.message).toContain("invalid");
    });

    test("InvalidRecordIdError", () => {
        const error = new InvalidRecordIdError("ID part is not valid");
        expect(error).toBeInstanceOf(SqonError);
        expect(error.name).toBe("InvalidRecordIdError");
    });

    test("InvalidDurationError", () => {
        const error = new InvalidDurationError();
        expect(error).toBeInstanceOf(SqonError);
        expect(error.name).toBe("InvalidDurationError");
    });

    test("InvalidDecimalError", () => {
        const error = new InvalidDecimalError();
        expect(error).toBeInstanceOf(SqonError);
        expect(error.name).toBe("InvalidDecimalError");
    });

    test("InvalidTableError", () => {
        const error = new InvalidTableError();
        expect(error).toBeInstanceOf(SqonError);
        expect(error.name).toBe("InvalidTableError");
    });
});
