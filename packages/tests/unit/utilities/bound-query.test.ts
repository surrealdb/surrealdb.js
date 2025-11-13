import { describe, expect, test } from "bun:test";
import { RecordId } from "surrealdb";
import { BoundQuery } from "../../../sdk/src/utils/bound-query";

describe("BoundQuery", () => {
    test("empty instance", () => {
        const query = new BoundQuery("");

        expect(query.query).toBe("");
        expect(query.bindings).toEqual({});
    });

    test("query only", () => {
        const query = new BoundQuery("SELECT * FROM table");

        expect(query.query).toBe("SELECT * FROM table");
        expect(query.bindings).toEqual({});
    });

    test("query and bindings", () => {
        const bindings = { id: 123, name: "test" };
        const query = new BoundQuery("SELECT * FROM $id", bindings);

        expect(query.query).toBe("SELECT * FROM $id");
        expect(query.bindings).toEqual(bindings);
    });

    test("cloning", () => {
        const original = new BoundQuery("SELECT * FROM table", { test: 123 });
        const cloned = new BoundQuery(original);

        expect(cloned.query).toBe(original.query);
        expect(cloned.bindings).toEqual(original.bindings);
    });

    test("appending", () => {
        const query = new BoundQuery("SELECT * FROM $id", { id: new RecordId("user", 123) });

        query.append(" WHERE active = $value", { value: true });

        expect(query.query).toBe("SELECT * FROM $id WHERE active = $value");
        expect(query.bindings).toMatchObject({ id: new RecordId("user", 123), value: true });
    });

    test("append template literal", () => {
        const query = new BoundQuery("SELECT * FROM $id", { id: new RecordId("user", 123) });

        query.append` WHERE active = ${true}`;

        expect(query.query).toBe("SELECT * FROM $id WHERE active = $bind__1");
        expect(query.bindings).toMatchObject({ id: new RecordId("user", 123), bind__1: true });
    });
});
