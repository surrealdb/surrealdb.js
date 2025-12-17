import type { ConnectionController } from "../controller";
import { ResponseError } from "../errors";
import { DispatchedPromise } from "../internal/dispatched-promise";
import { type MaybeJsonify, maybeJsonify } from "../internal/maybe-jsonify";
import type { QueryResponse, Session } from "../types";
import type { BoundQuery } from "../utils";
import { DoneFrame, ErrorFrame, type Frame, ValueFrame } from "../utils/frame";
import type { Uuid } from "../value";

interface QueryOptions {
	query: BoundQuery;
	transaction: Uuid | undefined;
	session: Session;
	json: boolean;
}

type Collect<T extends unknown[], J extends boolean> = T extends []
	? unknown[]
	: { [K in keyof T]: MaybeJsonify<T[K], J> };

type Responses<T extends unknown[], J extends boolean> = T extends []
	? QueryResponse[]
	: { [K in keyof T]: QueryResponse<MaybeJsonify<T[K], J>> };

/**
 * A configurable query sent to a SurrealDB instance.
 */
export class Query<
	R extends unknown[] = unknown[],
	J extends boolean = false,
> extends DispatchedPromise<Collect<R, J>> {
	#connection: ConnectionController;
	#options: QueryOptions;

	constructor(connection: ConnectionController, options: QueryOptions) {
		super();
		this.#connection = connection;
		this.#options = options;
	}

	/**
	 * Retrieve the inner query that will be sent to the database.
	 */
	get inner(): BoundQuery {
		return this.#options.query;
	}

	/**
	 * Configure the query to return the result of each response as a
	 * JSON-compatible structure.
	 *
	 * This is useful when query results need to be serialized. Keep in mind
	 * that your responses will lose SurrealDB type information.
	 */
	json(): Query<R, true> {
		return new Query(this.#connection, {
			...this.#options,
			json: true,
		});
	}

	/**
	 * Collect and return the results of all queries at once. If any of the queries fail, the promise
	 * will reject.
	 *
	 * You can optionally pass a list of query indexes to collect only the results of specific queries.
	 * 
	 * This is the same as awaiting the query directly, but allows specifying which queries to collect.
	 *
	 * @example
	 * ```ts
	 * const [people] = await this.query("SELECT * FROM person").collect<[Person[]]>();
	 * ```
	 *
	 * @param queries The queries to collect. If no queries are provided, all queries will be collected.
	 * @returns A promise that resolves to the results of all queries at once.
	 */
	async collect<T extends unknown[] = R>(...queries: number[]): Promise<Collect<T, J>> {
		await this.#connection.ready();

		const { query, transaction, session, json } = this.#options;
		const chunks = this.#connection.query(query, session, transaction);
		const responses: unknown[] = [];
		const queryIndexes =
			queries.length > 0 ? new Map(queries.map((idx, i) => [idx, i])) : undefined;

		for await (const chunk of chunks) {
			if (chunk.error) {
				throw new ResponseError(chunk.error);
			}

			if (queryIndexes?.has(chunk.query) === false) {
				continue;
			}

			const index = queryIndexes?.get(chunk.query) ?? chunk.query;

			if (chunk.kind === "single") {
				responses[index] = maybeJsonify(chunk.result?.[0], json);
				continue;
			}

			const additions = maybeJsonify(chunk.result ?? [], json);
			let records = responses[index] as unknown[];

			if (!records) {
				records = additions;
				responses[index] = records;
			} else {
				records.push(...additions);
			}
		}

		return responses as Collect<T, J>;
	}

	/**
	 * Stream the response frames of the query as they are received as an AsyncIterable.
	 *
	 * Each iteration yields a **value**, **error**, or **done** frame. The provided
	 * `isValue`, `isError`, and `isDone` methods can be used to check the type of frame.
	 * You can pass a query index to these functions to check if the frame is associated with a
	 * specific query.
	 *
	 * @example
	 * ```ts
	 * const stream = this.query("SELECT * FROM person").stream();
	 *
	 * for await (const frame of stream) {
	 *     if (frame.isValue<Person>(0)) {
	 *         // use frame.value
	 *     }
	 * }
	 * ```
	 *
	 * @returns An async iterable of query frames.
	 */
	async *stream<T = unknown>(): AsyncIterable<Frame<T, J>> {
		await this.#connection.ready();

		const { query, transaction, session, json } = this.#options;
		const chunks = this.#connection.query(query, session, transaction);

		for await (const chunk of chunks) {
			if (chunk.error) {
				yield new ErrorFrame<T, J>(chunk.query, chunk.stats, chunk.error);
				continue;
			}

			if (chunk.kind === "single") {
				yield new ValueFrame<T, J>(
					chunk.query,
					maybeJsonify(chunk.result?.[0] as T, json as J),
					true,
				);
				yield new DoneFrame<T, J>(chunk.query, chunk.stats, chunk.type ?? "other");
				continue;
			}

			const values = chunk.result as unknown[];

			for (const value of values) {
				yield new ValueFrame<T, J>(chunk.query, maybeJsonify(value as T, json as J), false);
			}

			if (chunk.kind === "batched-final") {
				yield new DoneFrame<T, J>(chunk.query, chunk.stats, chunk.type ?? "other");
			}
		}
	}

	/**
	 * Collect and return the responses of all queries at once. Failed queries will be returned
	 * with `success: false` and the associated error, while successful queries will have
	 * `success: true` and their result.
	 * 
	 * You can optionally pass a list of query indexes to collect only the results of specific responses.
	 * 
	 * @example
	 * ```ts
	 * const [people] = await this.query("SELECT * FROM person").responses<[Person[]]>();
	 * 
	 * people.success; // true
	 * people.result; // Person[]
	 * ```
	 * 
	 * @param queries The queries to collect. If no queries are provided, all queries will be collected.
	 * @returns A promise that resolves to the responses of all queries at once.
	 */
	async responses<T extends unknown[] = R>(...queries: number[]): Promise<Responses<T, J>> {
		await this.#connection.ready();

		const { query, transaction, session, json } = this.#options;
		const chunks = this.#connection.query(query, session, transaction);
		const collections: unknown[] = [];
		const responses: QueryResponse[] = [];
		const queryIndexes =
			queries.length > 0 ? new Map(queries.map((idx, i) => [idx, i])) : undefined;

		for await (const chunk of chunks) {
			if (queryIndexes?.has(chunk.query) === false) {
				if (chunk.error) {
					throw new ResponseError(chunk.error);
				}

				continue;
			}

			const index = queryIndexes?.get(chunk.query) ?? chunk.query;

			if (chunk.error) {
				responses[index] = {
					success: false,
					error: chunk.error,
					stats: chunk.stats,
				}
				continue;
			}

			if (chunk.kind === "single") {
				responses[index] = {
					success: true,
					result: maybeJsonify(chunk.result?.[0], json),
					stats: chunk.stats,
					type: chunk.type ?? "other",
				}
				continue;
			}

			const additions = maybeJsonify(chunk.result ?? [], json);
			let records = collections[index] as unknown[];

			if (!records) {
				records = additions;
				collections[index] = records;
			} else {
				records.push(...additions);
			}

			if (chunk.kind === "batched-final") {
				responses[index] = {
					success: true,
					result: records,
					stats: chunk.stats,
					type: chunk.type ?? "other",
				}
			}
		}

		return responses as Responses<T, J>;
	}

	async dispatch(): Promise<Collect<R, J>> {
		return this.collect();
	}
}
