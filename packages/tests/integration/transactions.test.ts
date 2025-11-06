import { describe, expect, test } from "bun:test";
import { satisfies } from "semver";
import { Features, RecordId } from "surrealdb";
import { createSurreal, requestVersion, SURREAL_PROTOCOL } from "./__helpers__";

const version = await requestVersion();
const is3x = satisfies(version, ">=3.0.0-alpha.1");

interface Person {
    id: RecordId<"person">;
    name: string;
}

describe.if(is3x && SURREAL_PROTOCOL === "ws")("transactions", async () => {
    test("feature", async () => {
        const surreal = await createSurreal();

        expect(surreal.isFeatureSupported(Features.Transactions)).toBeTrue();
    });

    test("committed transaction", async () => {
        const surreal = await createSurreal();
        const txn = await surreal.beginTransaction();

        const created = await txn.create<Person>(new RecordId("person", "john")).content({
            name: "John Doe",
        });

        expect(created).toStrictEqual({
            id: new RecordId("person", "john"),
            name: "John Doe",
        });

        let selected = await surreal.select<Person>(new RecordId("person", "john"));
        expect(selected).toBeUndefined();

        await txn.commit();

        selected = await surreal.select<Person>(new RecordId("person", "john"));
        expect(selected).toStrictEqual({
            id: new RecordId("person", "john"),
            name: "John Doe",
        });
    });

    test("cancelled transaction", async () => {
        const surreal = await createSurreal();
        const txn = await surreal.beginTransaction();

        const created = await txn.create<Person>(new RecordId("person", "john")).content({
            name: "John Doe",
        });

        expect(created).toStrictEqual({
            id: new RecordId("person", "john"),
            name: "John Doe",
        });

        let selected = await surreal.select<Person>(new RecordId("person", "john"));
        expect(selected).toBeUndefined();

        await txn.cancel();

        selected = await surreal.select<Person>(new RecordId("person", "john"));
        expect(selected).toBeUndefined();
    });
});
