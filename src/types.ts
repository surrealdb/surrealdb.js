import { z } from "zod";
import { RecordId } from "./library/data/recordid.ts";
import { Surreal } from "./surreal.ts";

export type StatusHooks = {
	onConnect?: () => unknown;
	onReconnect?: () => unknown;
	onDisconnect?: () => unknown;
	onError?: (error: Error) => unknown;
};

export const UseOptions = z.object({
	namespace: z.coerce.string(),
	database: z.coerce.string(),
});

export type UseOptions = z.infer<typeof UseOptions>;

export type ActionResult<
	T extends Record<string, unknown>,
> = Prettify<T['id'] extends RecordId ? T : { id: RecordId } & T>

export type Prettify<T> = {
	[K in keyof T]: T[K];
} & {};

//////////////////////////////////////////////
//////////   AUTHENTICATION TYPES   //////////
//////////////////////////////////////////////

export const SuperUserAuth = z.object({
	namespace: z.never().optional(),
	database: z.never().optional(),
	scope: z.never().optional(),
	username: z.coerce.string(),
	password: z.coerce.string(),
});

export type SuperUserAuth = z.infer<typeof SuperUserAuth>;

export const NamespaceAuth = z.object({
	namespace: z.coerce.string(),
	database: z.never().optional(),
	scope: z.never().optional(),
	username: z.coerce.string(),
	password: z.coerce.string(),
});

export type NamespaceAuth = z.infer<typeof NamespaceAuth>;

export const DatabaseAuth = z.object({
	namespace: z.coerce.string(),
	database: z.coerce.string(),
	scope: z.never().optional(),
	username: z.coerce.string(),
	password: z.coerce.string(),
});

export type DatabaseAuth = z.infer<typeof DatabaseAuth>;

export const ScopeAuth = z.object({
	namespace: z.coerce.string().optional(),
	database: z.coerce.string().optional(),
	scope: z.coerce.string(),
}).catchall(z.unknown());

export type ScopeAuth = z.infer<typeof ScopeAuth>;

export const AnyAuth = z.union([
	SuperUserAuth,
	NamespaceAuth,
	DatabaseAuth,
	ScopeAuth,
]);
export type AnyAuth = z.infer<typeof AnyAuth>;

export const Token = z.string({ invalid_type_error: "Not a valid token" });
export type Token = z.infer<typeof Token>;

export const TransformAuth = z.union([
	z.object({
		namespace: z.string().optional(),
		database: z.string().optional(),
		scope: z.never().optional(),
		username: z.string(),
		password: z.string(),
	}).transform(({
		namespace,
		database,
		username,
		password,
	}) => ({
		ns: namespace,
		db: database,
		user: username,
		pass: password,
	})),
	z.object({
		namespace: z.string(),
		database: z.string(),
		scope: z.string(),
	}).catchall(z.unknown()).transform(({
		namespace,
		database,
		scope,
		...rest
	}) => ({
		ns: namespace,
		db: database,
		sc: scope,
		...rest,
	})),
]);

export const HTTPAuthenticationResponse = z.discriminatedUnion("code", [
	z.object({
		code: z.literal(200),
		details: z.string(),
		token: z.string({
			required_error: "Did not recieve an authentication token",
			invalid_type_error: "Received an invalid token",
		}),
	}),
	z.object({
		code: z.literal(403),
		details: z.string(),
		description: z.string(),
		information: z.string(),
	}),
], { invalid_type_error: "Unexpected authentication response" });

export type HTTPAuthenticationResponse = z.infer<
	typeof HTTPAuthenticationResponse
>;

/////////////////////////////////////
//////////   QUERY TYPES   //////////
/////////////////////////////////////

export type Result<T = unknown> = ResultOk<T> | ResultErr;
export type ResultOk<T> = {
	result: T;
	error?: never;
};

export type ResultErr = {
	result?: never;
	error: {
		code: number;
		message: string;
	};
};

export type QueryResult<T = unknown> = QueryResultOk<T> | QueryResultErr;
export type QueryResultOk<T> = {
	status: "OK";
	time: string;
	result: T;
	detail?: never;
};

export type QueryResultErr = {
	status: "ERR";
	time: string;
	result?: never;
	detail: string;
};

export type MapQueryResult<T> = {
	[K in keyof T]: QueryResult<T[K]>;
};

export type RawQueryResult =
	| string
	| number
	| boolean
	| symbol
	| null
	| RawQueryResult[]
	| Record<string | number | symbol, unknown>;

export type LiveQueryClosureReason = "SOCKET_CLOSED" | "QUERY_KILLED";
export type LiveQueryResponse<
	T extends Record<string, unknown> = Record<string, unknown>,
> =
	| {
		action: "CLOSE";
		result?: never;
		detail: LiveQueryClosureReason;
	}
	| {
		action: "CREATE" | "UPDATE" | "DELETE";
		result: T;
		detail?: never;
	};

export type UnprocessedLiveQueryResponse<
	T extends Record<string, unknown> = Record<string, unknown>,
> = LiveQueryResponse<T> & {
	id: string;
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

///////////////////////////////////
//////////   WEBSOCKET   //////////
///////////////////////////////////

export enum WebsocketStatus {
	OPEN,
	CLOSED,
	RECONNECTING,
}

//////////////////////////////
//////////   HTTP   //////////
//////////////////////////////

export type InvalidSQL = {
	code: 400;
	details: "Request problems detected";
	description:
		"There is a problem with your request. Refer to the documentation for further information.";
	information: string;
};

export const HTTPConstructorOptions = z.object({
	fetch: z.function().optional(),
});

export type HTTPConstructorOptions<TFetcher = typeof fetch> = {
	fetch?: TFetcher;
};

///////////////////////////////
//////////   OTHER   //////////
///////////////////////////////

// deno-lint-ignore ban-types
type Constructor<T> = Function & { prototype: T };
type MaybePromise<T> = T | Promise<T>;

export type RawSocketMessageResponse =
	| (Result & { id: number })
	| RawSocketLiveQueryNotification;
export type RawSocketLiveQueryNotification = {
	result: UnprocessedLiveQueryResponse;
};

export type ConnectionOptions =
	& {
		prepare?: (connection: Surreal) => unknown;
		auth?: AnyAuth | Token;
	}
	& (
		| UseOptions
		| {
			namespace?: never;
			database?: never;
		}
	);

export function processConnectionOptions({
	prepare,
	auth,
	namespace,
	database,
}: ConnectionOptions) {
	z.function().optional().parse(prepare);
	z.union([Token, AnyAuth]).optional().parse(auth);
	const useOpts = namespace || database
		? UseOptions.parse({
			namespace,
			database,
		})
		: { namespace: undefined, database: undefined };

	return { prepare, auth, ...useOpts } satisfies ConnectionOptions;
}
