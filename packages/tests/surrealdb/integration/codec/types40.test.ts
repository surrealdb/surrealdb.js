import { describe, expect, test } from "bun:test";
import { BigDecimal, Interval, PlainDate, PlainTime, Regex, Timestamp } from "surrealdb";
import { createSurreal, hasTypes40, SURREAL_BACKEND } from "../__helpers__";

const TYPES40 = await hasTypes40();

const VALUES = [
    new PlainDate("2024-01-15"),
    new PlainTime("12:34:56.5"),
    new Timestamp("2024-01-15T12:34:56.123456789"),
    new Interval({ months: 14, days: 3, micros: 3_723_500_000n }),
    new BigDecimal("12345678901234567890123456789012345.5"),
    new Regex("^a+$"),
];

describe.if(TYPES40)("the types SurrealDB 4.0 shares with SQL", () => {
    test("are read from the literals that name them", async () => {
        const surreal = await createSurreal();

        const [values] = await surreal
            .query(
                'RETURN [pd"2024-01-15", pt"12:34:56.5", ts"2024-01-15T12:34:56.123456789", ivl"P1Y2M3DT1H2M3.5S", 12345678901234567890123456789012345.5bigdec, /^a+$/]',
            )
            .collect<[unknown[]]>();

        expect(values).toHaveLength(VALUES.length);
        for (const [i, value] of VALUES.entries()) {
            expect([i, value.equals(values[i])]).toEqual([i, true]);
        }
    });

    test("are sent with their kinds", async () => {
        const surreal = await createSurreal();

        const [kinds, values] = await surreal
            .query("RETURN $values.map(|$v| type::of($v)); RETURN $values", { values: VALUES })
            .collect<[string[], unknown[]]>();

        expect(kinds).toEqual(["date", "time", "timestamp", "interval", "bigdecimal", "regex"]);
        for (const [i, value] of VALUES.entries()) {
            expect([i, value.equals(values[i])]).toEqual([i, true]);
        }
    });

    test("read their infinities", async () => {
        const surreal = await createSurreal();

        const [values] = await surreal
            .query('RETURN [pd"infinity", pd"-infinity", ts"infinity"]')
            .collect<[unknown[]]>();

        expect(values[0]).toEqual(PlainDate.INFINITY);
        expect(values[1]).toEqual(PlainDate.NEG_INFINITY);
        expect((values[2] as Timestamp).equals(Timestamp.INFINITY)).toBe(true);
    });
});

describe.if(TYPES40 && SURREAL_BACKEND === "remote")("pgsql() and mysql()", () => {
    test("run PostgreSQL with positional parameters", async () => {
        const surreal = await createSurreal();
        await surreal.query("CREATE person:tobie SET name = 'Tobie', age = 30").collect();

        const result = await surreal.pgsql("SELECT name FROM person WHERE age > $1", { _1: 18 });

        const [statement] = result.statements;
        expect(statement?.status).toBe("OK");
        expect(statement?.status === "OK" && statement.rows).toEqual([{ name: "Tobie" }]);
        expect(result.transaction.status).toBe("idle");
    });

    test("report a failing statement with its SQLSTATE, and still succeed", async () => {
        const surreal = await createSurreal();

        const result = await surreal.pgsql("SELEC 1");

        const [statement] = result.statements;
        expect(statement?.status).toBe("ERR");
        expect(statement?.status === "ERR" && statement.error.sqlstate).toBe("42601");
    });

    test("run MySQL with rows as arrays", async () => {
        const surreal = await createSurreal();
        await surreal.query("CREATE person:jaime SET name = 'Jaime'").collect();

        const result = await surreal.mysql(
            "SELECT name FROM person WHERE name = ?",
            { _1: "Jaime" },
            { rowMode: "array" },
        );

        const [statement] = result.statements;
        expect(statement?.status === "OK" && statement.rows).toEqual([["Jaime"]]);
    });
});
