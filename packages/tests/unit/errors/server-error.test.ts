import { describe, expect, test } from "bun:test";
import {
    AlreadyExistsError,
    ConfigurationError,
    ErrorKind,
    InternalError,
    NotAllowedError,
    NotFoundError,
    QueryError,
    ResponseError,
    SerializationError,
    ServerError,
    ThrownError,
    ValidationError,
} from "surrealdb";

// The parse functions are internal, so we test them via the exported types
// by importing from the internal module directly.
import { parseRpcError, parseQueryError } from "../../../sdk/src/internal/parse-error";

// =========================================================== //
//  Error parsing: new format (kind present)                    //
// =========================================================== //

describe("parseRpcError (new format)", () => {
    test("NotAllowed with TokenExpired details", () => {
        const err = parseRpcError({
            code: -32002,
            kind: "NotAllowed",
            message: "Token has expired",
            details: { Auth: "TokenExpired" },
        });

        expect(err).toBeInstanceOf(ServerError);
        expect(err).toBeInstanceOf(NotAllowedError);
        expect(err.kind).toBe("NotAllowed");
        expect(err.code).toBe(-32002);
        expect(err.message).toBe("Token has expired");
        expect(err.details).toEqual({ Auth: "TokenExpired" });
        expect(err.cause).toBeUndefined();

        const notAllowed = err as NotAllowedError;
        expect(notAllowed.isTokenExpired).toBe(true);
        expect(notAllowed.isInvalidAuth).toBe(false);
        expect(notAllowed.isScriptingBlocked).toBe(false);
        expect(notAllowed.methodName).toBeUndefined();
        expect(notAllowed.functionName).toBeUndefined();
    });

    test("NotAllowed with InvalidAuth details", () => {
        const err = parseRpcError({
            code: -32002,
            kind: "NotAllowed",
            message: "Invalid credentials",
            details: { Auth: "InvalidAuth" },
        }) as NotAllowedError;

        expect(err.isInvalidAuth).toBe(true);
        expect(err.isTokenExpired).toBe(false);
    });

    test("NotAllowed with Method details", () => {
        const err = parseRpcError({
            code: -32602,
            kind: "NotAllowed",
            message: "Method not allowed",
            details: { Method: { name: "begin" } },
        }) as NotAllowedError;

        expect(err.methodName).toBe("begin");
        expect(err.isTokenExpired).toBe(false);
    });

    test("NotAllowed with Scripting details", () => {
        const err = parseRpcError({
            code: -32602,
            kind: "NotAllowed",
            message: "Scripting is blocked",
            details: { Scripting: {} },
        }) as NotAllowedError;

        expect(err.isScriptingBlocked).toBe(true);
    });

    test("NotAllowed with Function details", () => {
        const err = parseRpcError({
            code: -32602,
            kind: "NotAllowed",
            message: "Function not allowed",
            details: { Function: { name: "fn::custom" } },
        }) as NotAllowedError;

        expect(err.functionName).toBe("fn::custom");
    });

    test("NotFound with Table details", () => {
        const err = parseRpcError({
            code: -32000,
            kind: "NotFound",
            message: "Table not found",
            details: { Table: { name: "users" } },
        });

        expect(err).toBeInstanceOf(NotFoundError);
        expect(err.kind).toBe("NotFound");

        const nf = err as NotFoundError;
        expect(nf.tableName).toBe("users");
        expect(nf.recordId).toBeUndefined();
        expect(nf.methodName).toBeUndefined();
    });

    test("NotFound with Record details", () => {
        const err = parseRpcError({
            code: -32000,
            kind: "NotFound",
            message: "Record not found",
            details: { Record: { id: "users:123" } },
        }) as NotFoundError;

        expect(err.recordId).toBe("users:123");
        expect(err.tableName).toBeUndefined();
    });

    test("NotFound with Method details", () => {
        const err = parseRpcError({
            code: -32601,
            kind: "NotFound",
            message: "Method not found",
            details: { Method: { name: "unknown_method" } },
        }) as NotFoundError;

        expect(err.methodName).toBe("unknown_method");
    });

    test("NotFound with Namespace details", () => {
        const err = parseRpcError({
            code: -32000,
            kind: "NotFound",
            message: "Namespace not found",
            details: { Namespace: { name: "test" } },
        }) as NotFoundError;

        expect(err.namespaceName).toBe("test");
    });

    test("NotFound with Database details", () => {
        const err = parseRpcError({
            code: -32000,
            kind: "NotFound",
            message: "Database not found",
            details: { Database: { name: "test" } },
        }) as NotFoundError;

        expect(err.databaseName).toBe("test");
    });

    test("AlreadyExists with Record details", () => {
        const err = parseRpcError({
            code: -32000,
            kind: "AlreadyExists",
            message: "Record already exists",
            details: { Record: { id: "users:123" } },
        });

        expect(err).toBeInstanceOf(AlreadyExistsError);
        const ae = err as AlreadyExistsError;
        expect(ae.recordId).toBe("users:123");
        expect(ae.tableName).toBeUndefined();
    });

    test("AlreadyExists with Table details", () => {
        const err = parseRpcError({
            code: -32000,
            kind: "AlreadyExists",
            message: "Table already exists",
            details: { Table: { name: "users" } },
        }) as AlreadyExistsError;

        expect(err.tableName).toBe("users");
    });

    test("Validation with Parse details (string variant)", () => {
        const err = parseRpcError({
            code: -32700,
            kind: "Validation",
            message: "Parse error",
            details: "Parse",
        });

        expect(err).toBeInstanceOf(ValidationError);
        const ve = err as ValidationError;
        expect(ve.isParseError).toBe(true);
        expect(ve.parameterName).toBeUndefined();
    });

    test("Validation with InvalidParameter details", () => {
        const err = parseRpcError({
            code: -32603,
            kind: "Validation",
            message: "Invalid parameter",
            details: { InvalidParameter: { name: "limit" } },
        }) as ValidationError;

        expect(err.parameterName).toBe("limit");
        expect(err.isParseError).toBe(false);
    });

    test("Query with NotExecuted details", () => {
        const err = parseRpcError({
            code: -32003,
            kind: "Query",
            message: "Query not executed",
            details: { NotExecuted: {} },
        });

        expect(err).toBeInstanceOf(QueryError);
        const qe = err as QueryError;
        expect(qe.isNotExecuted).toBe(true);
        expect(qe.isTimedOut).toBe(false);
        expect(qe.isCancelled).toBe(false);
        expect(qe.timeout).toBeUndefined();
    });

    test("Query with TimedOut details", () => {
        const err = parseRpcError({
            code: -32004,
            kind: "Query",
            message: "Query timed out",
            details: { TimedOut: { duration: { secs: 5, nanos: 0 } } },
        }) as QueryError;

        expect(err.isTimedOut).toBe(true);
        expect(err.timeout).toEqual({ secs: 5, nanos: 0 });
    });

    test("Query with Cancelled details", () => {
        const err = parseRpcError({
            code: -32005,
            kind: "Query",
            message: "Query cancelled",
            details: { Cancelled: {} },
        }) as QueryError;

        expect(err.isCancelled).toBe(true);
    });

    test("Configuration error", () => {
        const err = parseRpcError({
            code: -32604,
            kind: "Configuration",
            message: "Live queries not supported",
            details: { LiveQueryNotSupported: {} },
        });

        expect(err).toBeInstanceOf(ConfigurationError);
        const ce = err as ConfigurationError;
        expect(ce.isLiveQueryNotSupported).toBe(true);
    });

    test("Serialization error", () => {
        const err = parseRpcError({
            code: -32008,
            kind: "Serialization",
            message: "Deserialization failed",
            details: { Deserialization: {} },
        });

        expect(err).toBeInstanceOf(SerializationError);
        const se = err as SerializationError;
        expect(se.isDeserialization).toBe(true);
    });

    test("Thrown error", () => {
        const err = parseRpcError({
            code: -32006,
            kind: "Thrown",
            message: "Custom user error",
        });

        expect(err).toBeInstanceOf(ThrownError);
        expect(err.kind).toBe("Thrown");
        expect(err.message).toBe("Custom user error");
    });

    test("Internal error", () => {
        const err = parseRpcError({
            code: -32000,
            kind: "Internal",
            message: "Something went wrong",
        });

        expect(err).toBeInstanceOf(InternalError);
    });

    test("error with no details", () => {
        const err = parseRpcError({
            code: -32000,
            kind: "NotFound",
            message: "Not found",
        });

        expect(err).toBeInstanceOf(NotFoundError);
        const nf = err as NotFoundError;
        expect(nf.details).toBeUndefined();
        expect(nf.tableName).toBeUndefined();
        expect(nf.recordId).toBeUndefined();
    });

    test("error with null details", () => {
        const err = parseRpcError({
            code: -32000,
            kind: "Internal",
            message: "Error",
            details: null,
        });

        expect(err.details).toBeUndefined();
    });
});

// =========================================================== //
//  Error parsing: old format (kind absent, derive from code)   //
// =========================================================== //

describe("parseRpcError (old format, kind derived from code)", () => {
    test("code -32700 -> Validation", () => {
        const err = parseRpcError({ code: -32700, message: "Parse error" });
        expect(err).toBeInstanceOf(ValidationError);
        expect(err.kind).toBe("Validation");
    });

    test("code -32600 -> Validation", () => {
        const err = parseRpcError({ code: -32600, message: "Invalid request" });
        expect(err).toBeInstanceOf(ValidationError);
    });

    test("code -32601 -> NotFound", () => {
        const err = parseRpcError({ code: -32601, message: "Method not found" });
        expect(err).toBeInstanceOf(NotFoundError);
    });

    test("code -32602 -> NotAllowed", () => {
        const err = parseRpcError({ code: -32602, message: "Method not allowed" });
        expect(err).toBeInstanceOf(NotAllowedError);
    });

    test("code -32603 -> Validation", () => {
        const err = parseRpcError({ code: -32603, message: "Invalid params" });
        expect(err).toBeInstanceOf(ValidationError);
    });

    test("code -32604 -> Configuration", () => {
        const err = parseRpcError({ code: -32604, message: "Live query not supported" });
        expect(err).toBeInstanceOf(ConfigurationError);
    });

    test("code -32605 -> Configuration", () => {
        const err = parseRpcError({ code: -32605, message: "Bad live query config" });
        expect(err).toBeInstanceOf(ConfigurationError);
    });

    test("code -32606 -> Configuration", () => {
        const err = parseRpcError({ code: -32606, message: "Bad graphql config" });
        expect(err).toBeInstanceOf(ConfigurationError);
    });

    test("code -32000 -> Internal", () => {
        const err = parseRpcError({ code: -32000, message: "Internal error" });
        expect(err).toBeInstanceOf(InternalError);
    });

    test("code -32001 -> Connection kind (base ServerError)", () => {
        const err = parseRpcError({ code: -32001, message: "Client error" });
        expect(err).toBeInstanceOf(ServerError);
        expect(err.kind).toBe("Connection");
    });

    test("code -32002 -> NotAllowed", () => {
        const err = parseRpcError({ code: -32002, message: "Invalid auth" });
        expect(err).toBeInstanceOf(NotAllowedError);
    });

    test("code -32003 -> Query", () => {
        const err = parseRpcError({ code: -32003, message: "Not executed" });
        expect(err).toBeInstanceOf(QueryError);
    });

    test("code -32004 -> Query", () => {
        const err = parseRpcError({ code: -32004, message: "Timed out" });
        expect(err).toBeInstanceOf(QueryError);
    });

    test("code -32005 -> Query", () => {
        const err = parseRpcError({ code: -32005, message: "Cancelled" });
        expect(err).toBeInstanceOf(QueryError);
    });

    test("code -32006 -> Thrown", () => {
        const err = parseRpcError({ code: -32006, message: "User throw" });
        expect(err).toBeInstanceOf(ThrownError);
    });

    test("code -32007 -> Serialization", () => {
        const err = parseRpcError({ code: -32007, message: "Serialization" });
        expect(err).toBeInstanceOf(SerializationError);
    });

    test("code -32008 -> Serialization", () => {
        const err = parseRpcError({ code: -32008, message: "Deserialization" });
        expect(err).toBeInstanceOf(SerializationError);
    });

    test("unknown code -> Internal", () => {
        const err = parseRpcError({ code: -99999, message: "Unknown" });
        expect(err).toBeInstanceOf(InternalError);
        expect(err.kind).toBe("Internal");
    });

    test("old format preserves code and message", () => {
        const err = parseRpcError({ code: -32002, message: "Invalid credentials" });
        expect(err.code).toBe(-32002);
        expect(err.message).toBe("Invalid credentials");
        expect(err.details).toBeUndefined();
        expect(err.cause).toBeUndefined();
    });
});

// =========================================================== //
//  Error parsing: query result errors                          //
// =========================================================== //

describe("parseQueryError", () => {
    test("new format with kind + details", () => {
        const err = parseQueryError({
            status: "ERR",
            time: "1ms",
            result: "Table not found",
            kind: "NotFound",
            details: { Table: { name: "users" } },
        });

        expect(err).toBeInstanceOf(NotFoundError);
        expect(err.kind).toBe("NotFound");
        expect(err.code).toBe(0);
        expect(err.message).toBe("Table not found");
        expect((err as NotFoundError).tableName).toBe("users");
    });

    test("old format (message only, no kind)", () => {
        const err = parseQueryError({
            status: "ERR",
            time: "1ms",
            result: "There was a problem with the database: Table not found",
        });

        expect(err).toBeInstanceOf(InternalError);
        expect(err.kind).toBe("Internal");
        expect(err.code).toBe(0);
        expect(err.message).toBe(
            "There was a problem with the database: Table not found",
        );
        expect(err.details).toBeUndefined();
    });

    test("with cause chain", () => {
        const err = parseQueryError({
            status: "ERR",
            time: "1ms",
            result: "Permission denied",
            kind: "NotAllowed",
            details: { Auth: "TokenExpired" },
            cause: {
                code: -32000,
                kind: "Internal",
                message: "Session expired",
            },
        });

        expect(err).toBeInstanceOf(NotAllowedError);
        expect(err.cause).toBeInstanceOf(InternalError);
        expect(err.cause?.message).toBe("Session expired");
    });
});

// =========================================================== //
//  Cause chain traversal                                       //
// =========================================================== //

describe("cause chain", () => {
    test("deep cause chain is parsed recursively", () => {
        const err = parseRpcError({
            code: -32000,
            kind: "NotAllowed",
            message: "Top level",
            cause: {
                code: -32000,
                kind: "NotFound",
                message: "Middle",
                cause: {
                    code: -32000,
                    kind: "Internal",
                    message: "Root cause",
                },
            },
        });

        expect(err).toBeInstanceOf(NotAllowedError);
        expect(err.cause).toBeInstanceOf(NotFoundError);
        expect(err.cause?.cause).toBeInstanceOf(InternalError);
        expect(err.cause?.cause?.message).toBe("Root cause");
        expect(err.cause?.cause?.cause).toBeUndefined();
    });

    test("hasKind traverses the chain", () => {
        const err = parseRpcError({
            code: -32000,
            kind: "NotAllowed",
            message: "Top",
            cause: {
                code: -32000,
                kind: "NotFound",
                message: "Nested",
            },
        });

        expect(err.hasKind("NotAllowed")).toBe(true);
        expect(err.hasKind("NotFound")).toBe(true);
        expect(err.hasKind("Internal")).toBe(false);
    });

    test("findCause returns matching error in chain", () => {
        const err = parseRpcError({
            code: -32000,
            kind: "NotAllowed",
            message: "Top",
            cause: {
                code: -32000,
                kind: "NotFound",
                message: "Nested not found",
                details: { Table: { name: "users" } },
            },
        });

        const found = err.findCause("NotFound");
        expect(found).toBeInstanceOf(NotFoundError);
        expect(found?.message).toBe("Nested not found");
        expect((found as NotFoundError).tableName).toBe("users");
    });

    test("findCause returns this if kind matches", () => {
        const err = parseRpcError({
            code: -32000,
            kind: "NotFound",
            message: "Self",
        });

        expect(err.findCause("NotFound")).toBe(err);
    });

    test("findCause returns undefined when not found", () => {
        const err = parseRpcError({
            code: -32000,
            kind: "NotFound",
            message: "No match",
        });

        expect(err.findCause("AlreadyExists")).toBeUndefined();
    });
});

// =========================================================== //
//  Forward compatibility: unknown kinds                        //
// =========================================================== //

describe("unknown error kinds", () => {
    test("unknown kind creates base ServerError", () => {
        const err = parseRpcError({
            code: -32000,
            kind: "FutureErrorKind",
            message: "Some new error",
            details: { SomeNewDetail: { foo: "bar" } },
        });

        expect(err).toBeInstanceOf(ServerError);
        expect(err).not.toBeInstanceOf(InternalError);
        expect(err.kind).toBe("FutureErrorKind");
        expect(err.message).toBe("Some new error");
        expect(err.details).toEqual({ SomeNewDetail: { foo: "bar" } });
    });

    test("unknown kind does not lose information", () => {
        const err = parseRpcError({
            code: -32000,
            kind: "BrandNew",
            message: "Details preserved",
        });

        expect(err.kind).toBe("BrandNew");
    });
});

// =========================================================== //
//  ErrorKind constants                                         //
// =========================================================== //

describe("ErrorKind", () => {
    test("provides string constants for all known kinds", () => {
        expect(ErrorKind.Validation).toBe("Validation");
        expect(ErrorKind.Configuration).toBe("Configuration");
        expect(ErrorKind.Thrown).toBe("Thrown");
        expect(ErrorKind.Query).toBe("Query");
        expect(ErrorKind.Serialization).toBe("Serialization");
        expect(ErrorKind.NotAllowed).toBe("NotAllowed");
        expect(ErrorKind.NotFound).toBe("NotFound");
        expect(ErrorKind.AlreadyExists).toBe("AlreadyExists");
        expect(ErrorKind.Connection).toBe("Connection");
        expect(ErrorKind.Internal).toBe("Internal");
    });

    test("can be used for comparison", () => {
        const err = parseRpcError({
            code: -32000,
            kind: "NotFound",
            message: "Test",
        });

        expect(err.kind === ErrorKind.NotFound).toBe(true);
    });
});

// =========================================================== //
//  ServerError class properties                                //
// =========================================================== //

describe("ServerError", () => {
    test("extends Error and SurrealError", () => {
        const err = new ServerError({
            kind: "Internal",
            message: "test",
        });

        expect(err).toBeInstanceOf(Error);
        expect(err).toBeInstanceOf(ServerError);
    });

    test("name includes kind", () => {
        const err = new ServerError({
            kind: "NotFound",
            message: "test",
        });

        expect(err.name).toBe("ServerError [NotFound]");
    });

    test("subclass name is the class name", () => {
        const err = new NotFoundError({
            kind: "NotFound",
            message: "test",
        });

        expect(err.name).toBe("NotFoundError");
    });

    test("defaults code to 0 when not provided", () => {
        const err = new ServerError({
            kind: "Internal",
            message: "test",
        });

        expect(err.code).toBe(0);
    });

    test("defaults details to undefined when null", () => {
        const err = new ServerError({
            kind: "Internal",
            message: "test",
            details: null,
        });

        expect(err.details).toBeUndefined();
    });

    test("message appears in stack trace", () => {
        const err = new ServerError({
            kind: "Internal",
            message: "test error message",
        });

        expect(err.stack).toContain("test error message");
    });
});

// =========================================================== //
//  ResponseError backward compat alias                         //
// =========================================================== //

describe("ResponseError alias", () => {
    test("ResponseError is ServerError", () => {
        expect(ResponseError).toBe(ServerError);
    });

    test("instanceof ResponseError works", () => {
        const err = parseRpcError({
            code: -32000,
            kind: "Internal",
            message: "test",
        });

        expect(err).toBeInstanceOf(ResponseError);
    });
});
