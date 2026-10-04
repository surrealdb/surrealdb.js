import { describe, expect, test } from "bun:test";
import { RecordId, Table } from "@surrealdb/sqon";
import { Surreal } from "../../../../sdk/src/api/surreal";
import { ExpressionError } from "../../../../sdk/src/errors";
import {
    assertTransactionSafe,
    composeQueries,
    joinQueries,
    resolveQueries,
} from "../../../../sdk/src/internal/compose-queries";
import { BoundQuery } from "../../../../sdk/src/utils/bound-query";
import { surql } from "../../../../sdk/src/utils/tagged-template";

// Never connected: building queries does not need a connection.
const db = new Surreal();
const person = new Table("person");

// Binding names are numbered from a counter shared by every query
const normalize = (query: string) => query.replaceAll(/bind__\d+/g, "bind__N");

describe("composeQueries", () => {
    test("joins the statements of each input in order", () => {
        const query = composeQueries(["RETURN 1", "RETURN 2", "RETURN 3"]);

        expect(query.query).toBe("RETURN 1\n;\nRETURN 2\n;\nRETURN 3");
        expect(query.bindings).toEqual({});
    });

    test("tolerates inputs which end with a semicolon", () => {
        expect(composeQueries(["RETURN 1;", "RETURN 2;"]).query).toBe("RETURN 1;\n;\nRETURN 2;");
    });

    test("separates inputs on a new line, so a trailing line comment cannot swallow the separator", () => {
        const query = composeQueries(["RETURN 1 -- one", "RETURN 2"]);

        expect(query.query).toBe("RETURN 1 -- one\n;\nRETURN 2");
    });

    test("a single input is passed through untouched", () => {
        expect(composeQueries(["RETURN 1"]).query).toBe("RETURN 1");
    });

    test("an empty list composes an empty query", () => {
        expect(composeQueries([]).query).toBe("");
    });

    test("does not modify its inputs", () => {
        const first = surql`RETURN ${1}`;
        const second = surql`RETURN ${2}`;
        const before = { first: first.query, second: second.query };

        composeQueries([first, second]);

        expect({ first: first.query, second: second.query }).toEqual(before);
    });

    describe("inputs", () => {
        test("accepts strings", () => {
            expect(composeQueries(["RETURN 1"]).query).toBe("RETURN 1");
        });

        test("accepts BoundQuery values, and merges their bindings", () => {
            const query = composeQueries([
                surql`SELECT * FROM person WHERE age > ${18}`,
                new BoundQuery("RETURN $name", { name: "Tobie" }),
            ]);

            const names = Object.keys(query.bindings);

            expect(names).toHaveLength(2);
            expect(query.bindings.name).toBe("Tobie");
            expect(query.query).toContain("RETURN $name");
        });

        test("accepts query builders, which contribute the statement they compile to", () => {
            const select = db.select(person);
            const create = db.create(new RecordId("person", "tobie")).content({ name: "Tobie" });
            const query = composeQueries([select, create]);

            expect(normalize(query.query)).toBe(
                "SELECT * FROM $bind__N\n;\nCREATE ONLY $bind__N CONTENT $bind__N",
            );

            // Each binding of each builder, under its own name
            const values = Object.values(query.bindings);

            expect(values).toHaveLength(3);
            expect(values[0]).toEqual(person);
            expect(values[2]).toEqual({ name: "Tobie" });
        });

        // `api()` needs a connection to be built, so it is covered by the integration tests
        test("accepts every kind of query builder", () => {
            const id = new RecordId("person", "tobie");

            const inputs = [
                db.select(person),
                db.create(person),
                db.update(id),
                db.upsert(id),
                db.delete(id),
                db.insert(person, { name: "Tobie" }),
                db.relate(id, new Table("knows"), new RecordId("person", "jaime")),
                db.run("fn::example", []),
                db.auth(),
            ];

            const resolved = resolveQueries(inputs);

            expect(resolved).toHaveLength(inputs.length);
            for (const query of resolved) {
                expect(query.query.trim()).not.toBe("");
            }
        });

        test("ignores how a builder is configured to return its result, which is not part of its statement", () => {
            const plain = db.select(person);
            const configured = db.select(person).json();

            expect(normalize(composeQueries([configured]).query)).toBe(
                normalize(composeQueries([plain]).query),
            );
        });

        test("accepts a Query, which contributes its inner query", () => {
            const inner = db.query(surql`RETURN ${1}`);
            const query = composeQueries([inner, "RETURN 2"]);

            expect(query.query).toBe(`${inner.inner.query}\n;\nRETURN 2`);
            expect(query.bindings).toEqual(inner.inner.bindings);
        });

        test("accepts a Query which was itself composed", () => {
            const inner = db.query(["RETURN 1", "RETURN 2"]);

            expect(composeQueries([inner, "RETURN 3"]).query).toBe(
                "RETURN 1\n;\nRETURN 2\n;\nRETURN 3",
            );
        });

        test("rejects a live query, naming its index", () => {
            expect(() => composeQueries(["RETURN 1", db.live(person)])).toThrow(ExpressionError);
            expect(() => composeQueries(["RETURN 1", db.live(person)])).toThrow(
                /queries\[1\].*live/,
            );
        });

        test("rejects an empty input, naming its index", () => {
            expect(() => composeQueries(["RETURN 1", ""])).toThrow("queries[1] is empty");
            expect(() => composeQueries(["  \n\t "])).toThrow("queries[0] is empty");
            expect(() => composeQueries([new BoundQuery()])).toThrow("queries[0] is empty");
        });

        test.each([
            ["a number", 1],
            ["null", null],
            ["undefined", undefined],
            ["a plain object", {}],
            ["an array", ["RETURN 1"]],
        ])("rejects %s, naming its index", (_, input) => {
            expect(() => composeQueries(["RETURN 1", input as never])).toThrow(ExpressionError);
            expect(() => composeQueries(["RETURN 1", input as never])).toThrow(
                /queries\[1\] is not a query/,
            );
        });

        test("rejects a builder which does not compile into a BoundQuery", () => {
            expect(() => composeQueries([{ compile: () => "RETURN 1" } as never])).toThrow(
                "queries[0].compile() did not return a BoundQuery",
            );
        });

        test("rejects something which is not an array", () => {
            expect(() => composeQueries("RETURN 1" as never)).toThrow(
                "queries must be an array of queries",
            );
        });
    });

    describe("result mapping", () => {
        // The server answers with one result per statement, so what matters is that
        // composing queries is the same as writing their statements out one after another.
        test("a single statement per input maps inputs to results one to one", () => {
            const inputs = ["RETURN 1", surql`RETURN ${2}`, db.select(person)];

            expect(resolveQueries(inputs)).toHaveLength(3);
            expect(composeQueries(inputs).query.split("\n;\n")).toHaveLength(3);
        });

        test("an input with several statements takes several slots", () => {
            const query = composeQueries(["RETURN 1; RETURN 2", "RETURN 3"]);

            // Three statements in total, although there are two inputs
            expect(query.query).toBe("RETURN 1; RETURN 2\n;\nRETURN 3");
        });

        test("is equivalent to appending the inputs to a BoundQuery", () => {
            const first = surql`CREATE person SET age = ${1}`;
            const second = surql`CREATE person SET age = ${2}`;

            const appended = new BoundQuery();
            appended.append(first).append(";\n").append(second);

            const composed = composeQueries([first, second]);

            expect(composed.bindings).toEqual(appended.bindings);
            expect(composed.query.replaceAll(/\s*;\s*/g, ";")).toBe(
                appended.query.replaceAll(/\s*;\s*/g, ";"),
            );
        });
    });
});

describe("binding conflicts", () => {
    test("two inputs binding the same name throw, naming both inputs and the parameter", () => {
        const first = new BoundQuery("RETURN $id", { id: 1 });
        const second = new BoundQuery("RETURN $id", { id: 2 });

        expect(() => composeQueries([first, second])).toThrow(ExpressionError);
        expect(() => composeQueries([first, second])).toThrow(
            /'\$id' is bound by both queries\[0\] and queries\[1\]/,
        );
    });

    test("names the inputs which conflict, not the neighbors", () => {
        const a = new BoundQuery("RETURN $a", { a: 1 });
        const b = new BoundQuery("RETURN $b", { b: 2 });
        const c = new BoundQuery("RETURN $a", { a: 3 });

        expect(() => composeQueries([a, b, c])).toThrow(
            /'\$a' is bound by both queries\[0\] and queries\[2\]/,
        );
    });

    test("conflicts even when both bind the same value", () => {
        const first = new BoundQuery("RETURN $id", { id: 1 });
        const second = new BoundQuery("RETURN $id", { id: 1 });

        expect(() => composeQueries([first, second])).toThrow(/'\$id'/);
    });

    test("the same BoundQuery twice conflicts, as it binds its names twice", () => {
        const query = surql`RETURN ${1}`;

        expect(() => composeQueries([query, query])).toThrow(
            /is bound by both queries\[0\] and queries\[1\]/,
        );
    });

    test("names the array the way the caller does", () => {
        const first = new BoundQuery("RETURN $id", { id: 1 });

        expect(() => joinQueries([first, first], "statements")).toThrow(
            /statements\[0\] and statements\[1\]/,
        );
    });

    test("the surql tag generates unique names, so it never conflicts with itself", () => {
        const inputs = Array.from({ length: 50 }, (_, i) => surql`RETURN ${i}`);
        const query = composeQueries(inputs);

        expect(Object.keys(query.bindings)).toHaveLength(50);
    });

    test("query builders generate unique names, so they never conflict with each other", () => {
        const id = new RecordId("person", "tobie");
        const query = composeQueries([
            db.select(id),
            db.select(id),
            db.update(id).merge({ a: 1 }),
            db.update(id).merge({ a: 1 }),
        ]);

        const names = Object.keys(query.bindings);

        expect(new Set(names).size).toBe(names.length);
    });

    test("names generated by surql and by builders do not conflict with each other", () => {
        const query = composeQueries([
            surql`RETURN ${1}`,
            db.select(person),
            surql`RETURN ${2}`,
            db.create(person).content({ a: 1 }),
        ]);

        const names = Object.keys(query.bindings);

        expect(new Set(names).size).toBe(names.length);
    });
});

describe("assertTransactionSafe", () => {
    const check = (...inputs: string[]) => assertTransactionSafe(resolveQueries(inputs));

    test("accepts ordinary statements", () => {
        expect(() =>
            check("CREATE person SET a = 1", "UPDATE person SET a = 2; DELETE person", "SELECT 1"),
        ).not.toThrow();
    });

    test.each(["BEGIN", "COMMIT", "CANCEL", "begin transaction", "Commit Transaction", "cancel;"])(
        "rejects %p, naming its index",
        (statement) => {
            expect(() => check("CREATE person", statement)).toThrow(ExpressionError);
            expect(() => check("CREATE person", statement)).toThrow(/queries\[1\] contains a/);
        },
    );

    test("rejects a transaction statement in the middle of a multi-statement input", () => {
        expect(() => check("CREATE a; COMMIT; CREATE b")).toThrow(
            "queries[0] contains a COMMIT statement",
        );
    });

    test("rejects a complete transaction", () => {
        expect(() => check("BEGIN; CREATE a; COMMIT;")).toThrow("queries[0] contains a BEGIN");
    });

    test("accepts the words in strings, comments and blocks", () => {
        expect(() =>
            check(
                `CREATE note SET text = 'BEGIN; COMMIT; CANCEL;'`,
                `CREATE note SET text = "BEGIN; COMMIT;"`,
                "-- BEGIN;\nSELECT 1 /* COMMIT; */ # CANCEL;",
                "DEFINE FUNCTION fn::a() { LET $x = 1; RETURN $x }",
                "SELECT begin, commit, cancel FROM thing",
                "SELECT * FROM `BEGIN`",
            ),
        ).not.toThrow();
    });

    describe("RETURN", () => {
        test("accepts a RETURN as the last statement", () => {
            expect(() => check("CREATE a", "RETURN 1")).not.toThrow();
            expect(() => check("CREATE a; RETURN 1")).not.toThrow();
            expect(() => check("RETURN 1")).not.toThrow();
        });

        test("rejects a RETURN followed by a statement of another input", () => {
            expect(() => check("RETURN 1", "CREATE a")).toThrow(ExpressionError);
            expect(() => check("CREATE a", "RETURN 1", "CREATE b")).toThrow(
                /queries\[1\] contains a RETURN statement which is followed by another statement \(in queries\[2\]\)/,
            );
        });

        test("rejects a RETURN followed by a statement of the same input", () => {
            expect(() => check("RETURN 1; CREATE a")).toThrow(
                /queries\[0\] contains a RETURN statement which is followed by another statement \(in queries\[0\]\)/,
            );
        });

        test("rejects two RETURN statements in a row", () => {
            expect(() => check("RETURN 1", "RETURN 2")).toThrow(/queries\[0\] contains a RETURN/);
        });

        test("accepts a RETURN clause, which is not a RETURN statement", () => {
            expect(() =>
                check(
                    "CREATE a RETURN AFTER",
                    "UPDATE a SET b = 1 RETURN NONE",
                    "DELETE a RETURN BEFORE",
                    "INSERT INTO a { b: 1 } RETURN VALUE b",
                ),
            ).not.toThrow();
        });

        test("accepts statements which produce a value without ending the transaction", () => {
            expect(() =>
                check("LET $a = 1", "$a + 1", "SELECT * FROM a", "(1 + 2)", "{ a: 1 }"),
            ).not.toThrow();
        });

        test("accepts a RETURN inside a block expression", () => {
            expect(() => check("LET $a = { RETURN 1 }", "SELECT * FROM a")).not.toThrow();
        });

        test("reports a transaction statement ahead of a RETURN which precedes it", () => {
            expect(() => check("RETURN 1", "COMMIT")).toThrow(/contains a COMMIT/);
        });

        // Servers before 3.0 replace the results of the statements before a RETURN with its own
        describe("where a RETURN replaces the results of the statements before it", () => {
            const legacy = (...inputs: string[]) =>
                assertTransactionSafe(resolveQueries(inputs), "queries", {
                    returnReplacesResults: true,
                });

            test("rejects a RETURN even when it is last", () => {
                expect(() => legacy("CREATE a", "RETURN 1")).toThrow(ExpressionError);
                expect(() => legacy("CREATE a", "RETURN 1")).toThrow(
                    /queries\[1\] contains a RETURN statement.*before 3\.0/,
                );
                expect(() => legacy("RETURN 1")).toThrow(/queries\[0\] contains a RETURN/);
                expect(() => legacy("CREATE a; RETURN 1")).toThrow(
                    /queries\[0\] contains a RETURN/,
                );
            });

            test("accepts everything which is not a RETURN statement", () => {
                expect(() =>
                    legacy(
                        "CREATE a RETURN AFTER",
                        "LET $a = { RETURN 1 }",
                        "$a + 1",
                        "SELECT * FROM a",
                    ),
                ).not.toThrow();
            });

            test("still rejects the statements which a transaction supplies itself", () => {
                expect(() => legacy("COMMIT")).toThrow(/contains a COMMIT/);
            });
        });
    });
});
