export enum SurrealQLMethod {
	ping = "ping",
	info = "info",
	use = "use",
	signup = "signup",
	signin = "signin",
	authenticate = "authenticate",
	invalidate = "invalidate",
	kill = "kill",
	live = "live",
	let = "let",
	set = "set",
	query = "query",
	select = "select",
	create = "create",
	update = "update",
	change = "change",
	modify = "modify",
	delete = "delete",
}

export type NAMESPACE = any; // TODO
export type DB = any; // TODO
export type JWT_TOKEN = string;
export type UUID = string;
export type TABLE_NAME = string;
export type PARAM_NAME = string;
export type JSON = string;
export type RECORD_ID = string;
export type JSON_PATCH = Record<any, unknown>;
export type RECORD_DIFFS<TRecord> = unknown;
export type QUERY_TEXT = string;
export type QUERY_PARAMS = Record<string, any>;
export type QUERY_RESULT = Record<any, any>[];

interface SurrealQLRequests<TRecord extends any = never> {
	[SurrealQLMethod.ping]: {
		params: [];
		response: unknown;
	};
	[SurrealQLMethod.info]: {
		params: [];
		response: unknown;
	};
	[SurrealQLMethod.use]: {
		params: [NAMESPACE | undefined, DB | undefined]; // TODO or is it `[NAMESPACE, DB] | [undefined, undefined]`
		response: unknown;
	};
	[SurrealQLMethod.signup]: {
		params: [Record<string, unknown>];
		response: unknown;
	};
	[SurrealQLMethod.signin]: {
		params: [Record<string, unknown>];
		response: unknown;
	};
	[SurrealQLMethod.authenticate]: {
		params: [JWT_TOKEN];
		response: unknown;
	};
	[SurrealQLMethod.invalidate]: {
		params: [];
		response: unknown;
	};
	[SurrealQLMethod.kill]: {
		params: [UUID];
		response: unknown;
	};
	[SurrealQLMethod.live]: {
		params: [TABLE_NAME];
		response: unknown;
	};
	[SurrealQLMethod.let]: {
		params: [PARAM_NAME, JSON];
		response: unknown;
	};
	[SurrealQLMethod.set]: SurrealQLRequests[SurrealQLMethod.let];
	[SurrealQLMethod.query]: {
		params: [QUERY_TEXT, QUERY_PARAMS];
		response: QUERY_RESULT[];
	};
	[SurrealQLMethod.select]: {
		params: [TABLE_NAME | RECORD_ID];
		response: unknown[]; // TODO
	};
	[SurrealQLMethod.create]: {
		params: [TABLE_NAME | RECORD_ID, undefined | TRecord];
		response: unknown[]; // TODO
	};
	[SurrealQLMethod.update]: {
		params: [TABLE_NAME | RECORD_ID, undefined | TRecord];
		response: unknown[]; // TODO
	};
	[SurrealQLMethod.change]: {
		params: [TABLE_NAME | RECORD_ID, undefined | TRecord];
		response: unknown[]; // TODO
	};
	[SurrealQLMethod.modify]: {
		params: [TABLE_NAME | RECORD_ID, JSON_PATCH[]]; // TODO
		response: RECORD_DIFFS<TRecord>[];
	};
	[SurrealQLMethod.delete]: {
		params: [TABLE_NAME | RECORD_ID];
		response: Record<never, never>[];
	};
}

export interface SurrealQLRequest<
	TMethod extends SurrealQLMethod = SurrealQLMethod,
	TRecord extends any = never,
> extends Pick<SurrealQLRequests<TRecord>[TMethod], "params"> {
	id: string;
	method: TMethod;
}

export type SurrealQLParams<TMethod extends SurrealQLMethod = SurrealQLMethod> =
	SurrealQLRequests[TMethod]["params"];

export type SurrealQLResponse<
	TMethod extends SurrealQLMethod = SurrealQLMethod,
	TRecord extends any = never,
> = SurrealQLRequests<TRecord>[TMethod]["response"];

/**
 * Advantages
 * - no need for dedicated request names
 * - use of `SurrealQLRequest` without generics to support every Request type
 * - coupling of request and response type
 */

/**
 * Example usage
	```ts
	interface ExampleRecord {
		someProp: string;
	}

	const requestA: SurrealQLRequest<SurrealQLMethod.create, ExampleRecord> = {
		id: "...",
		method: SurrealQLMethod.create,
		params: [
			"SOME_TABLE_NAME",
			{
				someProp: "record",
			},
		],
	};

	const responseA: SurrealQLResponse<SurrealQLMethod.create, ExampleRecord> = [];
	```
 */
