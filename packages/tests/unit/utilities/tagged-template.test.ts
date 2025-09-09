import { beforeEach, describe, expect, test } from "bun:test";
import { eq, raw, surql, Table } from "surrealdb";
import { resetIncrementalID } from "../../../sdk/src/internal/get-incremental-id";

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
});
