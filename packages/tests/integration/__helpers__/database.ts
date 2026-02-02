import { RecordId, type Surreal, surql, Table } from "surrealdb";

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

export async function defineMockApi(surreal: Surreal): Promise<void> {
    await surreal.query(surql`
        DEFINE API '/identity'
			FOR get
                THEN {
                    RETURN {
						body: $request.body,
						headers: $request.headers,
					}
                };
    `);

    await surreal.query(surql`
		DEFINE API '/params'
			FOR get
				THEN {
					RETURN {
						body: $request.query,
						headers: $request.headers,
					}
				};
	`);

    await surreal.query(surql`
		DEFINE API '/error'
			FOR get
				THEN {
					RETURN {
						status: 500
					}
				};
	`);
}
