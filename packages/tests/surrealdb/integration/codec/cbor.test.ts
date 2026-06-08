import { describe, expect, test } from "bun:test";
import { RecordId } from "surrealdb";
import { createSurreal } from "../__helpers__";

describe("cbor codec", async () => {
    test("value encode visitor", async () => {
        const surreal = await createSurreal({
            driverOptions: {
                codecOptions: {
                    valueDecodeVisitor(value) {
                        if (value instanceof RecordId) {
                            return new RecordId("person", "jaime");
                        }

                        return value;
                    },
                },
            },
        });

        await surreal.create(new RecordId("person", "tobie"));

        const [result] = await surreal
            .query(`SELECT * FROM ONLY person LIMIT 1`)
            .collect<[{ id: RecordId }]>();

        expect(result.id.toString()).toEqual("person:jaime");
    });

    test("value decode visitor", async () => {
        const surreal = await createSurreal({
            driverOptions: {
                codecOptions: {
                    valueDecodeVisitor(value) {
                        if (value instanceof RecordId) {
                            return new RecordId("foo", "bar");
                        }

                        return value;
                    },
                },
            },
        });

        const [result] = await surreal
            .query(`RETURN { one: hello:world, two: "test", three: 123 }`)
            .collect<[{ one: RecordId; two: string; three: number }]>();

        expect(result.one.toString()).toEqual("foo:bar");
        expect(result.two).toEqual("test");
        expect(result.three).toEqual(123);
    });
});
