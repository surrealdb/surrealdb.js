import type { Fill } from "./cbor";
import { type RecordId, Uuid } from "./data";
import { SurrealDbError } from "./errors";
import type { PreparedQuery } from "./util/prepared-query";

export type ActionResult<T extends Record<string, unknown>> = Prettify<
	T["id"] extends RecordId ? T : { id: RecordId } & T
>;

export type Prettify<T> = {
	[K in keyof T]: T[K];
} & {}; // deno-lint-ignore ban-types

export type QueryParameters =
	| [query: string, bindings?: Record<string, unknown>]
	| [prepared: PreparedQuery, gaps?: Fill[]];

//////////////////////////////////////////////
//////////   AUTHENTICATION TYPES   //////////
//////////////////////////////////////////////

export function convertAuth(params: AnyAuth): Record<string, unknown> {
	let result: Record<string, unknown> = {};
	const convertString = (a: string, b: string, optional?: boolean) => {
		if (a in params) {
			result[b] = `${params[a as keyof AnyAuth]}`;
			delete result[a];
		} else if (optional !== true) {
			throw new SurrealDbError(
				`Key ${a} is missing from the authentication parameters`,
			);
		}
	};

	if ("scope" in params) {
		result = { ...params };
		convertString("scope", "sc");
		convertString("namespace", "ns");
		convertString("database", "db");
	} else if ("variables" in params) {
		result = { ...params.variables };
		convertString("access", "ac");
		convertString("namespace", "ns");
		convertString("database", "db");
	} else {
		convertString("access", "ac", true);
		convertString("database", "db", true);
		convertString("namespace", "ns", !("database" in params));
		convertString("username", "user");
		convertString("password", "pass");
	}

	return result;
}

export type RootAuth = {
	username: string;
	password: string;
};

export type NamespaceAuth = {
	namespace: string;
	username: string;
	password: string;
};

export type DatabaseAuth = {
	namespace: string;
	database: string;
	username: string;
	password: string;
};

export type AccessSystemAuth = Prettify<
	(RootAuth | NamespaceAuth | DatabaseAuth) & {
		access: string;
		variables?: never;
	}
>;

export type ScopeAuth = {
	namespace?: string;
	database?: string;
	scope: string;
	[K: string]: unknown;
};

export type AccessRecordAuth = {
	namespace?: string;
	database?: string;
	access: string;
	variables: {
		ns?: never;
		db?: never;
		ac?: never;
		[K: string]: unknown;
	};
};

export type AnyAuth =
	| RootAuth
	| NamespaceAuth
	| DatabaseAuth
	| ScopeAuth
	| AccessSystemAuth
	| AccessRecordAuth;

export type Token = string;

/////////////////////////////////////
//////////   QUERY TYPES   //////////
/////////////////////////////////////

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

/////////////////////////////////////
//////////   PATCH TYPES   //////////
/////////////////////////////////////

type BasePatch<T = string> = {
	path: T;
};

export type AddPatch<T = string, U = unknown> = BasePatch<T> & {
	op: "add";
	value: U;
};

export type RemovePatch<T = string> = BasePatch<T> & {
	op: "remove";
};

export type ReplacePatch<T = string, U = unknown> = BasePatch<T> & {
	op: "replace";
	value: U;
};

export type ChangePatch<T = string, U = string> = BasePatch<T> & {
	op: "change";
	value: U;
};

export type CopyPatch<T = string, U = string> = BasePatch<T> & {
	op: "copy";
	from: U;
};

export type MovePatch<T = string, U = string> = BasePatch<T> & {
	op: "move";
	from: U;
};

export type TestPatch<T = string, U = unknown> = BasePatch<T> & {
	op: "test";
	value: U;
};

export type Patch =
	| AddPatch
	| RemovePatch
	| ReplacePatch
	| ChangePatch
	| CopyPatch
	| MovePatch
	| TestPatch;

// RPC

export type RpcRequest<
	Method extends string = string,
	Params extends unknown[] | undefined = unknown[],
> = {
	method: Method;
	params?: Params;
};

export type RpcResponse<Result = unknown> =
	| RpcResponseOk<Result>
	| RpcResponseErr;

export type RpcResponseOk<Result = unknown> = {
	result: Result;
	error?: never;
};

export type RpcResponseErr = {
	result?: never;
	error: {
		code: number;
		message: string;
	};
};

// Live

export const liveActions = ["CREATE", "UPDATE", "DELETE"] as const;
export type LiveAction = (typeof liveActions)[number];
export type LiveResult = {
	id: Uuid;
	action: LiveAction;
	result: Record<string, unknown>;
};

export type LiveHandlerArguments<
	Result extends Record<string, unknown> | Patch = Record<string, unknown>,
> =
	| [action: LiveAction, result: Result]
	| [action: "CLOSE", result: "killed" | "disconnected"];

export type LiveHandler<
	Result extends Record<string, unknown> | Patch = Record<string, unknown>,
> = (...[action, result]: LiveHandlerArguments<Result>) => unknown;

export function isLiveResult(v: unknown): v is LiveResult {
	if (typeof v !== "object") return false;
	if (v === null) return false;
	if (!("id" in v && "action" in v && "result" in v)) return false;

	if (!(v.id instanceof Uuid)) return false;
	if (!liveActions.includes(v.action as LiveAction)) return false;
	if (typeof v.result !== "object") return false;
	if (v.result === null) return false;

	return true;
}

/////////////////////////////////////
/////////   EXPORT TYPES   //////////
/////////////////////////////////////

export type ExportOptions = {
	users: boolean;
	accesses: boolean;
	params: boolean;
	functions: boolean;
	analyzers: boolean;
	versions: boolean;
	tables: boolean | string[];
	records: boolean;
};
