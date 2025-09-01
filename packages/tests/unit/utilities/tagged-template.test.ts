import { describe, expect, test } from "bun:test";
import { surql, Table } from "surrealdb";

describe("Tagged template", () => {
    test("empty string", () => {
        const query = surql``;

        expect(query.query).toBe("");
        expect(query.bindings).toEqual({});
    });

    test("query with interpolation", () => {
        const table = new Table("table");
        const query = surql`SELECT * FROM ${table}`;

        expect(query.query).toStartWith(`SELECT * FROM $bind_`);
        expect(Object.keys(query.bindings)).toHaveLength(1);
    });
});
