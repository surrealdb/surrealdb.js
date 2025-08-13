import { RecordId, Table } from "surrealdb";
import type { AnySurreal } from "./surreal";

export const personTable: Table<"person"> = new Table("person");
export const graphTable: Table<"graph"> = new Table("graph");

export type Person = {
    id: RecordId<"person">;
    firstname: string;
    lastname: string;
    age?: number;
};

export async function insertMockRecords(surreal: AnySurreal): Promise<void> {
    await surreal.insert([
        {
            id: new RecordId("person", 1),
            firstname: "John",
            lastname: "Doe",
        },
        {
            id: new RecordId("person", 2),
            firstname: "Mary",
            lastname: "Doe",
        },
    ]);
}
