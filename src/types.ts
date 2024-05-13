import { z } from "npm:zod";
import { RecordId } from "./library/cbor/recordid.ts";
import { Surreal } from "./surreal.ts";
import { UUID } from "./library/cbor/uuid.ts";

export const UseOptions = z.object({
	namespace: z.coerce.string(),
	database: z.coerce.string(),
});

export type UseOptions = z.infer<typeof UseOptions>;

export type ActionResult<
	T extends Record<string, unknown>,
> = Prettify<T["id"] extends RecordId ? T : { id: RecordId } & T>;

export type Prettify<T> =
	& {
		[K in keyof T]: T[K];
	}
	// deno-lint-ignore ban-types
	& {};

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
	}) => {
		const vars: Record<string, unknown> = {
			user: username,
			pass: password,
		};

		if (namespace) {
			vars.ns = namespace;
			if (database) {
				vars.db = database;
			}
		}

		return vars;
	}),
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

// Connection options

export type ConnectionOptions =
	& {
		versionCheck?: boolean;
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

// RPC

export type RpcRequest<
	Method extends string = string,
	Params extends unknown[] | undefined = unknown[],
> = {
	method: Method;
	params?: Params;
};

export type RpcResponse<Result extends unknown = unknown> =
	| RpcResponseOk<Result>
	| RpcResponseErr;

export type RpcResponseOk<Result extends unknown = unknown> = {
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

export const Action = z.union([
	z.literal("CREATE"),
	z.literal("UPDATE"),
	z.literal("DELETE"),
]);

export type Action = z.infer<typeof Action>;

export const LiveResult = z.object({
	id: z.instanceof(UUID as never) as z.ZodType<
		typeof UUID,
		z.ZodTypeDef,
		typeof UUID
	>,
	action: Action,
	result: z.record(z.unknown()),
});

export type LiveResult = z.infer<typeof LiveResult>;

export type LiveHandler<
	Result extends Record<string, unknown> | Patch = Record<string, unknown>,
> = (action: Action, result: Result) => unknown;
