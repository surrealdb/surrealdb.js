import { beforeEach, describe, expect, test } from "bun:test";
import { eq, raw, surql, Table } from "surrealdb";
import { resetIncrementalID } from "../../../sdk/src/internal/get-incremental-id";
import { BoundQuery } from "../../../sdk/src/utils/bound-query";

beforeEach(() => {
    resetIncrementalID();
});

describe("Tagged template", () => {
    test("empty string", () => {
        const query = surql``;

        expect(query.query).toBe("");
        expect(query.bindings).toEqual({});
    });

    test("query with interpolation", () => {
        const table = new Table("table");
        const query = surql`SELECT * FROM ${table}`;

        expect(query.query).toMatchSnapshot();
        expect(Object.keys(query.bindings)).toHaveLength(1);
    });

    test("query with expression", () => {
        const table = new Table("table");
        const query = surql`SELECT * FROM ${table} WHERE ${eq("foo", "bar")}`;

        expect(query.query).toMatchSnapshot();
        expect(Object.keys(query.bindings)).toHaveLength(2);
    });

    test("query with raw insertion", () => {
        const table = new Table("table");

        const query = surql`SELECT ${raw("(SELECT foo FROM ->has->bar)")} FROM ${table}`;

        expect(query.query).toMatchSnapshot();
        expect(Object.keys(query.bindings)).toHaveLength(1);
    });

    test("query with embedded BoundQuery", () => {
        const username = "john";
        const byUserName = surql`username = ${username}`;
        const query = surql`SELECT * FROM user WHERE ${byUserName}`;

        expect(query.query).toMatchSnapshot();
        expect(Object.keys(query.bindings)).toHaveLength(1);
        expect(Object.values(query.bindings)).toContain("john");
    });

    test("query with multiple embedded BoundQueries", () => {
        const fields = surql`id, username, email`;
        const username = "john";
        const byUserName = surql`username = ${username}`;
        const query = surql`SELECT ${fields} FROM user WHERE ${byUserName}`;

        expect(query.query).toMatchSnapshot();
        expect(Object.keys(query.bindings)).toHaveLength(1);
        expect(Object.values(query.bindings)).toContain("john");
    });

    test("query with mixed BoundQuery and regular values", () => {
        const table = new Table("user");
        const limit = 10;
        const byUserName = surql`username = ${"john"}`;
        const query = surql`SELECT * FROM ${table} WHERE ${byUserName} LIMIT ${limit}`;

        expect(query.query).toMatchSnapshot();
        expect(Object.keys(query.bindings)).toHaveLength(3);
        expect(Object.values(query.bindings)).toContainEqual(new Table("user"));
        expect(Object.values(query.bindings)).toContain("john");
        expect(Object.values(query.bindings)).toContain(10);
    });

    test("query with binding conflict throws", () => {
        const a = new BoundQuery("a = $x", { x: 1 });
        const b = new BoundQuery("b = $x", { x: 2 });

        expect(() => surql`${a} AND ${b}`).toThrow(
            "Parameter conflict: 'x' already exists in this BoundQuery",
        );
    });
});
