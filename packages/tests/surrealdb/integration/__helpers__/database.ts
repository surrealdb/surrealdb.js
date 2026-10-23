import { RecordId, type StringRecordId, type Surreal, Table } from "surrealdb";
import { SURREAL_PROTOCOL } from "./env";

export const testTable: Table<"test"> = new Table("test");
export const personTable: Table<"person"> = new Table("person");
export const graphTable: Table<"graph"> = new Table("graph");

export interface Person {
    id: RecordId<"person"> | StringRecordId;
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

export async function defineMockApi(surreal: Surreal): Promise<void> {
    const remote = SURREAL_PROTOCOL !== "mem";
    const output = remote ? "MIDDLEWARE api::res::body('cbor')" : "";
    const input = remote ? "MIDDLEWARE api::req::body('cbor'), api::res::body('cbor')" : "";
    await surreal.query(`
        DEFINE API '/identity'
            FOR get ${output}
                THEN { RETURN { body: NONE, headers: $request.headers }; }
            FOR post ${input}
                THEN { RETURN { body: $request.body, headers: $request.headers }; };
        DEFINE API '/nested/path' FOR get ${output}
            THEN { RETURN { body: "nested" }; };
        DEFINE API '/params' FOR get ${output}
            THEN { RETURN { body: $request.query, headers: $request.headers }; };
        DEFINE API '/error' FOR get
            THEN { RETURN { status: 500 }; };
    `);
}
