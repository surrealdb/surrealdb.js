import { RecordId, type RecordIdRange, type Table } from "./data";
import { SurrealDbError } from "./errors";
import type { Surreal } from "./surreal";

const valueToSurrealQL = (value: unknown) => {
	let surQLValue: string;

	// Common JavaScript objects
	if (value instanceof Date) {
		surQLValue = `d"${value.toISOString()}"`;
	} else if (value instanceof RecordId) {
		surQLValue = value.toString();
	} else if (Array.isArray(value)) {
		surQLValue = JSON.stringify(value);
	} else {
		// Basic object types
		switch (typeof value) {
			case "symbol": {
				throw new SurrealDbError("Cannot use a JS Symbol as a key value");
			}
			case "function": {
				throw new SurrealDbError("Cannot use a JS Function as a key value");
			}
			case "bigint": {
				surQLValue = value.toString();
				break;
			}
			case "number":
			case "boolean": {
				surQLValue = value.toString();
				break;
			}
			case "string": {
				let sanitized: string = value;
				sanitized = sanitized.replace(/⟨/g, "\\⟨");
				sanitized = sanitized.replace(/⟩/g, "\\⟩");
				surQLValue = `⟨${sanitized}⟩`;
				break;
			}
			case "object": {
				surQLValue = JSON.stringify(value);
				break;
			}
			case "undefined": {
				surQLValue = "NULL";
				break;
			}
		}
	}
	return surQLValue;
};

export class Transaction<T extends unknown[]> {
	private queryQueue: ([string] | [string, Record<string, unknown>])[] = [];
	private connection: Surreal;

	constructor({
		db,
	}: {
		db: Surreal;
	}) {
		this.connection = db;
	}

	/**
	 * Commit and run the transaction, returning the last result
	 */
	async commit<T>(): Promise<T> {
		const argList = this.queryQueue.map((q) => q[1]);
		const args = argList.reduce((a, b) => {
			if (a === undefined && b === undefined) return {};
			if (a === undefined) return b;
			if (b === undefined) return a;
			return Object.assign(a, b);
		}, {});

		// Build a transaction query as a string
		const results = await this.connection.query<T[]>(
			[
				"BEGIN TRANSACTION;",
				...this.queryQueue.map((q) => q[0]),
				"COMMIT TRANSACTION;",
			].join("\n"),
			args,
		);

		// TODO: What does this need to return, and how should that be typed?
		// @ts-ignore
		return results.pop();
	}

	/**
	 * Commit and run the transaction, returning **all** of the query results
	 */
	async commitRaw<T extends unknown[]>(): Promise<T> {
		const argList = this.queryQueue.map((q) => q[1]);
		const args = argList.reduce((a, b) => {
			if (a === undefined && b === undefined) return {};
			if (a === undefined) return b;
			if (b === undefined) return a;
			return Object.assign(a, b);
		}, {});

		// Build a transaction query as a string
		return this.connection.query<T>(
			[
				"BEGIN TRANSACTION;",
				...this.queryQueue.map((q) => q[0]),
				"COMMIT TRANSACTION;",
			].join("\n"),
			args,
		);
	}

	/**
	 * Switch to a specific namespace and database.
	 * @param namespace - Switches to a specific namespace.
	 * @param database - Switches to a specific database.
	 */
	use({
		namespace,
		database,
	}: {
		namespace?: string | null;
		database?: string | null;
	}): true {
		if (namespace === null && database !== null) {
			throw new SurrealDbError(
				"Cannot unset namespace without unsetting database",
			);
		}

		const rx = /[⟨⟩]/;
		if (typeof namespace === "string" && rx.test(namespace)) {
			throw new SurrealDbError(
				"Namespace may not include mathematical parenthesis",
			);
		}

		if (typeof database === "string" && rx.test(database)) {
			throw new SurrealDbError(
				"Database may not include mathematical parenthesis",
			);
		}

		this.queryQueue.push([`USE NS ⟨${namespace}⟩;`]);
		this.queryQueue.push([`USE DB ⟨${database}⟩;`]);

		return true;
	}

	/**
	 * Selects everything from the [$auth](https://surrealdb.com/docs/surrealql/parameters) variable.
	 * ```sql
	 * SELECT * FROM $auth;
	 * ```
	 * Make sure the user actually has the permission to select their own record, otherwise you'll get back an empty result.
	 * @return The record linked to the record ID used for authentication
	 */
	info(): void {
		this.queryQueue.push(["SELECT * FROM $auth;"]);
	}

	/**
	 * Specify a variable for the transaction.
	 * @param key - Specifies the name of the variable.
	 * @param val - Assigns the value to the variable name.
	 */
	let(key: string, value: unknown): true {
		if (key.includes("`")) {
			throw new SurrealDbError("Key may not include backticks");
		}

		this.queryQueue.push([`LET $\`${key}\` = ${valueToSurrealQL(value)};`]);

		return true;
	}

	/**
	 * Remove a variable from the transaction.
	 * @param key - Specifies the name of the variable.
	 */
	async unset(key: string): Promise<true> {
		if (key.includes("`")) {
			throw new SurrealDbError("Key may not include backticks");
		}
		this.queryQueue.push([`LET $\`${key}\` = null;`]);
		return true;
	}

	/**
	 * Runs a set of SurrealQL statements against the database.
	 * @param query - Specifies the SurrealQL statements.
	 * @param bindings - Assigns variables which can be used in the query.
	 */
	query(query: string, bindings: Record<string, unknown>): true {
		let localQuery = query;
		if (localQuery === null) {
			throw new SurrealDbError("Query must be provided");
		}
		localQuery = localQuery.trim();

		if (!localQuery.endsWith(";")) localQuery += ";";

		this.queryQueue.push([localQuery, bindings]);
		return true;
	}

	/**
	 * Selects all records in a table, or a specific record, from the database.
	 * If you intend on sorting, filtering, or performing other operations on the data, it is recommended to use the `query` method instead.
	 * @param thing - The table name or a record ID to select.
	 */
	select(thing: RecordId | RecordIdRange | Table | string): true {
		if (thing == null) {
			throw new SurrealDbError(
				"RecordId, RecordIdRange, Table or string must be provided",
			);
		}

		if (typeof thing === "string" && /[⟨⟩]/.test(thing)) {
			throw new SurrealDbError("Thing may not include mathematical braces.");
		}
		this.queryQueue.push([`SELECT * FROM ${valueToSurrealQL(thing)};`]);
		return true;
	}

	/**
	 * Creates a record in the database.
	 * @param thing - The table name or the specific record ID to create.
	 * @param data - The document / record data to insert.
	 */
	create<U extends Record<string, unknown>>(
		thing: RecordId | Table | string,
		data?: U,
	): true {
		if (thing == null) {
			throw new SurrealDbError("RecordId, Table or string must be provided");
		}

		if (typeof thing === "string" && /[⟨⟩]/.test(thing)) {
			throw new SurrealDbError("Thing may not include mathematical braces.");
		}

		if (data) {
			let props = "";
			const entries = Object.entries(data);
			for (let i = 0; i < entries.length; i++) {
				const [k, v] = entries[i];
				props += `⟨${k}⟩ = ${valueToSurrealQL(v)}`;
			}

			this.queryQueue.push([`CREATE ${valueToSurrealQL(thing)} SET ${props};`]);
		} else {
			this.queryQueue.push([`CREATE ${valueToSurrealQL(thing)};`]);
		}

		return true;
	}

	/**
	 * Inserts one or multiple records in the database.
	 * @param table - The table name to insert into.
	 * @param data - The document(s) / record(s) to insert.
	 */
	insert<U extends Record<string, unknown>>(
		table: Table | string,
		data?: U | U[],
	): true {
		if (table == null) {
			throw new SurrealDbError("RecordId, Table or string must be provided");
		}

		if (typeof table === "string" && /[⟨⟩]/.test(table)) {
			throw new SurrealDbError("Table may not include mathematical braces.");
		}

		const items = Array.isArray(data) ? data : [data];

		for (let i = 0; i < items.length; i++) {
			const item = items[i];
			this.queryQueue.push([
				`INSERT INTO ${valueToSurrealQL(table)} ${JSON.stringify(item)};`,
			]);
		}

		return true;
	}

	/**
	 * TODO: Implement this stub.
	 * Inserts one or multiple records in the database.
	 * @param thing - The table name or the specific record ID to create.
	 * @param data - The document(s) / record(s) to insert.
	 */
	insertRelation(): true {
		throw new SurrealDbError("Not Implemented");
	}

	/**
	 * Updates all records in a table, or a specific record, in the database.
	 *
	 * ***NOTE: This function replaces the current document / record data with the specified data.***
	 * @param thing - The table name or the specific record ID to update.
	 * @param data - The document / record data to insert.
	 */
	update<U extends Record<string, unknown>>(
		thing: RecordId | RecordIdRange | Table | string,
		data?: U,
	): true {
		if (thing == null) {
			throw new SurrealDbError(
				"RecordId, RecordIdRange, Table or string must be provided",
			);
		}

		if (typeof thing === "string" && /[⟨⟩]/.test(thing)) {
			throw new SurrealDbError("Thing may not include mathematical braces.");
		}

		this.queryQueue.push([
			`UPDATE ${valueToSurrealQL(thing)} CONTENT ${JSON.stringify(data)};`,
		]);

		return true;
	}

	/**
	 * Upserts all records in a table, or a specific record, in the database.
	 *
	 * ***NOTE: This function replaces the current document / record data with the specified data.***
	 * @param thing - The table name or the specific record ID to upsert.
	 * @param data - The document / record data to insert.
	 */
	upsert<U extends Record<string, unknown>>(
		thing: RecordId | RecordIdRange | Table | string,
		data?: U,
	): true {
		if (thing == null) {
			throw new SurrealDbError(
				"RecordId, RecordIdRange, Table or string must be provided",
			);
		}

		if (typeof thing === "string" && /[⟨⟩]/.test(thing)) {
			throw new SurrealDbError("Thing may not include mathematical braces.");
		}

		if (!data) {
			throw new SurrealDbError("Data must be provided");
		}

		let props = "";
		const entries = Object.entries(data);
		for (let i = 0; i < entries.length; i++) {
			const [k, v] = entries[i];
			props += `⟨${k}⟩ = ${valueToSurrealQL(v)}`;
		}
		this.queryQueue.push([`UPSERT ${thing.toString()} SET ${props};`]);

		return true;
	}

	/**
	 * Modifies all records in a table, or a specific record, in the database.
	 *
	 * ***NOTE: This function merges the current document / record data with the specified data.***
	 * @param thing - The table name or the specific record ID to change.
	 * @param data - The document / record data to insert.
	 */
	merge<U extends Record<string, unknown>>(
		thing: RecordId | RecordIdRange | Table | string,
		data?: U,
	): true {
		if (thing == null) {
			throw new SurrealDbError(
				"RecordId, RecordIdRange, Table or string must be provided",
			);
		}

		if (typeof thing === "string" && /[⟨⟩]/.test(thing)) {
			throw new SurrealDbError("Thing may not include mathematical braces.");
		}

		this.queryQueue.push([
			`UPDATE ${valueToSurrealQL(thing)} MERGE ${JSON.stringify(data)};`,
		]);

		return true;
	}

	/**
	 * Applies JSON Patch changes to all records, or a specific record, in the database.
	 *
	 * ***NOTE: This function patches the current document / record data with the specified JSON Patch data.***
	 * @param thing - The table name or the specific record ID to modify.
	 * @param data - The JSON Patch data with which to modify the records.
	 */
	patch<U extends Record<string, unknown>>(
		thing: RecordId | RecordIdRange | Table | string,
		data?: U,
	): true {
		if (thing == null) {
			throw new SurrealDbError(
				"RecordId, RecordIdRange, Table or string must be provided",
			);
		}
		if (typeof thing === "string" && /[⟨⟩]/.test(thing)) {
			throw new SurrealDbError("Thing may not include mathematical braces.");
		}

		this.queryQueue.push([
			`UPDATE ${valueToSurrealQL(thing)} PATCH ${JSON.stringify(data)};`,
		]);

		return true;
	}

	/**
	 * Deletes all records in a table, or a specific record, from the database.
	 * @param thing - The table name or a record ID to select.
	 */
	delete(thing: RecordId | RecordIdRange | Table | string): true {
		if (thing == null) {
			throw new SurrealDbError(
				"RecordId, RecordIdRange, Table or string must be provided",
			);
		}

		if (typeof thing === "string" && /[⟨⟩]/.test(thing)) {
			throw new SurrealDbError("Thing may not include mathematical braces.");
		}

		this.queryQueue.push([`DELETE ${valueToSurrealQL(thing)};`]);

		return true;
	}

	/**
	 * TODO: Implement this stub.
	 * Run a SurrealQL function
	 * @param name - The full name of the function
	 * @param version - The version of the function. If omitted, the second argument is the parameter list.
	 * @param args - The arguments supplied to the function.
	 */
	run(name: string, arg2?: string | unknown[], arg3?: unknown[]): true {
		throw new SurrealDbError("Not Implemented");
	}

	/**
	 * TODO: Implement this stub.
	 * Obtain the version of the SurrealDB instance
	 * @param from - The in property on the edge record
	 * @param thing - The id of the edge record
	 * @param to - The out property on the edge record
	 * @param data - Optionally, provide a body for the edge record
	 */
	relate(): true {
		throw new SurrealDbError("Not Implemented");
	}
}
