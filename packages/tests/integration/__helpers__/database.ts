import { RecordId, type Surreal, Table } from "surrealdb";

export const testTable: Table<"test"> = new Table("test");
export const personTable: Table<"person"> = new Table("person");
export const graphTable: Table<"graph"> = new Table("graph");

export interface Person {
    id: RecordId<"person">;
    firstname: string;
    lastname: string;
    age?: number;
}

export async function insertMockRecords(surreal: Surreal): Promise<void> {
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
