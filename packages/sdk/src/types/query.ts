import type { Fill } from "@surrealdb/cbor";
import type { Jsonify, PreparedQuery } from "../utils";

export type QueryParameters =
	| [query: string, bindings?: Record<string, unknown>]
	| [prepared: PreparedQuery, gaps?: Fill[]];

export type QueryResult<T = unknown> = QueryResultOk<T> | QueryResultErr;
export type QueryResultOk<T> = {
	status: "OK";
	time: string;
	result: T;
};

export type QueryResultErr = {
	status: "ERR";
	time: string;
	result: string;
};

export type MapQueryResult<T> = {
	[K in keyof T]: QueryResult<T[K]>;
};

export type MapJsonify<T> = {
	[K in keyof T]: Jsonify<T[K]>;
};
