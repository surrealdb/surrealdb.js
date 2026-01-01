import { describe, expect, test } from "bun:test";
import { getRpcProtocolVersion, isVersionSupported } from "surrealdb";

describe("isVersionSupported()", () => {
    test("1.0.0 should be unsupported", () => {
        expect(isVersionSupported("1.0.0")).toBe(false);
    });

    test("1.5.6 should be unsupported", () => {
        expect(isVersionSupported("1.5.6")).toBe(false);
    });

    test("2.0.0 should be supported", () => {
        expect(isVersionSupported("2.0.0")).toBe(true);
    });

    test("3.0.0 should be supported", () => {
        expect(isVersionSupported("3.0.0")).toBe(true);
    });

    test("3.99.99 should be supported", () => {
        expect(isVersionSupported("3.99.99")).toBe(true);
    });

    test("4.0.0 should be unsupported", () => {
        expect(isVersionSupported("4.0.0")).toBe(false);
    });
});

describe("getRpcProtocolVersion()", () => {
    test("2.0.0 should use RPC v1", () => {
        expect(getRpcProtocolVersion("2.0.0")).toBe(1);
    });

    test("2.4.0 should use RPC v1", () => {
        expect(getRpcProtocolVersion("2.4.0")).toBe(1);
    });

    test("2.99.99 should use RPC v1", () => {
        expect(getRpcProtocolVersion("2.99.99")).toBe(1);
    });

    test("3.0.0 should use RPC v2", () => {
        expect(getRpcProtocolVersion("3.0.0")).toBe(2);
    });

    test("3.0.0-beta.1 should use RPC v2", () => {
        expect(getRpcProtocolVersion("3.0.0-beta.1")).toBe(2);
    });

    test("3.1.0 should use RPC v2", () => {
        expect(getRpcProtocolVersion("3.1.0")).toBe(2);
    });

    test("surrealdb-3.0.0 prefix should be handled", () => {
        expect(getRpcProtocolVersion("surrealdb-3.0.0")).toBe(2);
    });

    test("surrealdb-2.4.0 prefix should be handled", () => {
        expect(getRpcProtocolVersion("surrealdb-2.4.0")).toBe(1);
    });
});
