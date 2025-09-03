import { beforeEach, describe, expect, test } from "bun:test";
import { and, between, eq, expr, inside, not, or, raw } from "surrealdb";
import { resetIncrementalID } from "../../../sdk/src/internal/get-incremental-id";

beforeEach(() => {
    resetIncrementalID();
});

describe("expression", () => {
    test("empty", () => {
        const json = expr(null);

        expect(json.query).toBe("");
        expect(json.bindings).toEqual({});
    });

    test("equality", () => {
        const json = expr(eq("foo", "bar"));

        expect(json.query).toMatchSnapshot();
        expect(json.bindings).toMatchSnapshot();
    });

    test("and", () => {
        const json = expr(and(eq("foo", "bar"), eq("hello", "world"), eq("alpha", "beta")));

        expect(json.query).toMatchSnapshot();
        expect(json.bindings).toMatchSnapshot();
    });

    test("or", () => {
        const json = expr(or(eq("foo", "bar"), eq("hello", "world"), eq("alpha", "beta")));

        expect(json.query).toMatchSnapshot();
        expect(json.bindings).toMatchSnapshot();
    });

    test("not", () => {
        const json = expr(or(eq("foo", "bar"), not(eq("hello", "world"))));

        expect(json.query).toMatchSnapshot();
        expect(json.bindings).toMatchSnapshot();
    });

    test("conditional", () => {
        const json = expr(or(eq("foo", "bar"), false && eq("hello", "world"), eq("alpha", "beta")));

        expect(json.query).toMatchSnapshot();
        expect(json.bindings).toMatchSnapshot();
    });

    test("raw", () => {
        const json = expr(and(eq("foo", "bar"), raw("(SELECT VALUE foo FROM ->has->bar)")));

        expect(json.query).toMatchSnapshot();
        expect(json.bindings).toMatchSnapshot();
    });

    test("complex", () => {
        const json = expr(
            and(
                eq("hello", "world"),
                eq("foo", "bar"),
                or(inside("hello", ["hello"]), between("number", 1, 10)),
            ),
        );

        expect(json.query).toMatchSnapshot();
        expect(json.bindings).toMatchSnapshot();
    });
});
