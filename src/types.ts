import { type RecordId, Uuid } from "./data";

export type ActionResult<T extends Record<string, unknown>> = Prettify<
	T["id"] extends RecordId ? T : { id: RecordId } & T
>;

export type Prettify<T> = {
	[K in keyof T]: T[K];
} & {}; // deno-lint-ignore ban-types

//////////////////////////////////////////////
//////////   AUTHENTICATION TYPES   //////////
//////////////////////////////////////////////

export function convertAuth(params: AnyAuth): Record<string, unknown> {
	const cloned: Record<string, unknown> = { ...params };
	const convertString = (a: string, b: string, optional?: boolean) => {
		if (a in params) {
			cloned[b] = `${cloned[a]}`;
			delete cloned[a];
		} else if (optional !== true) {
			throw new Error(`Key ${a} is missing from the authentication parameters`);
		}
	};

	if ("access" in params) {
		convertString("access", "ac");
		convertString("namespace", "ns");
		convertString("database", "db");
	} else if ("scope" in params) {
		convertString("scope", "sc");
		convertString("namespace", "ns");
		convertString("database", "db");
	} else {
		convertString("database", "db", !("namespace" in params));
		convertString("namespace", "ns", !("database" in params));
		convertString("username", "user");
		convertString("password", "pass");
	}

	return cloned;
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

export type ScopeAuth = {
	namespace?: string;
	database?: string;
	scope: string;
	[K: string]: unknown;
};

export type AccessAuth = {
	namespace?: string;
	database?: string;
	access: string;
	[K: string]: unknown;
};

export type AnyAuth =
	| RootAuth
	| NamespaceAuth
	| DatabaseAuth
	| ScopeAuth
	| AccessAuth;

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

export type LiveHandler<
	Result extends Record<string, unknown> | Patch = Record<string, unknown>,
> = (action: LiveAction, result: Result) => unknown;

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
