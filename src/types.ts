export type ConnectionStrategy = "websocket" | "experimental_http";
export interface Connection {
	constructor: Constructor<
		(url?: string, options?: ConnectionOptions) => void
	>;

	strategy: "ws" | "http";
	connect: (url: string, options?: ConnectionOptions) => void;
	ping: () => Promise<void>;
	use: (opt: { ns: string; db: string }) => MaybePromise<void>;
	info?: <T extends Record<string, unknown> = Record<string, unknown>>() =>
		Promise<T | undefined>;

	signup: (vars: Partial<ScopeAuth> & Pick<ScopeAuth, "SC">) => Promise<Token>;
	signin: (vars: AnyAuth) => Promise<Token | void>;
	authenticate: (token: Token) => MaybePromise<void>;
	invalidate: () => MaybePromise<void>;

	let?: (variable: string, value: unknown) => Promise<void>;
	unset?: (variable: string) => Promise<void>;

	query: <T extends RawQueryResult[]>(
		query: string,
		vars?: Record<string, unknown>,
	) => Promise<MapQueryResult<T>>;

	select: <T extends Record<string, unknown>>(
		thing: string,
	) => Promise<ActionResult<T>[]>;

	create: <
		T extends Record<string, unknown>,
		U extends Record<string, unknown> = T,
	>(
		thing: string,
		data?: U,
	) => Promise<ActionResult<T, U>[]>;

	update: <
		T extends Record<string, unknown>,
		U extends Record<string, unknown> = T,
	>(
		thing: string,
		data?: U,
	) => Promise<ActionResult<T, U>[]>;

	merge: <
		T extends Record<string, unknown>,
		U extends Record<string, unknown> = Partial<T>,
	>(
		thing: string,
		data?: U,
	) => Promise<ActionResult<T, U>[]>;

	// Patch method is not available in the HTTP REST API
	patch?: (thing: string, data?: Patch[]) => Promise<Patch[]>;

	delete: <T extends Record<string, unknown>>(
		thing: string,
	) => Promise<ActionResult<T>[]>;
}

export type ConnectionOptions =
	& {
		prepare?: (connection: Connection) => unknown;
		auth?: AnyAuth | Token;
	}
	& (
		| {
			ns: string;
			db: string;
		}
		| {
			ns?: never;
			db?: never;
		}
	);

export type HTTPConnectionOptions<TFetcher = typeof fetch> =
	& ConnectionOptions
	& {
		fetch?: TFetcher;
	};

export type ActionResult<
	T extends Record<string, unknown>,
	U extends Record<string, unknown> = T,
> = T & U & { id: string };

//////////////////////////////////////////////
//////////   AUTHENTICATION TYPES   //////////
//////////////////////////////////////////////

export type SuperUserAuth = {
	user: string;
	pass: string;
};

export type NamespaceAuth = {
	NS: string;
	user: string;
	pass: string;
};

export type DatabaseAuth = {
	NS: string;
	DB: string;
	user: string;
	pass: string;
};

export type ScopeAuth = {
	NS: string;
	DB: string;
	SC: string;
	[T: string]: unknown;
};

export type AnyAuth = SuperUserAuth | NamespaceAuth | DatabaseAuth | ScopeAuth;
export type Token = string;

export type HTTPAuthenticationResponse =
	| {
		code: 200;
		details: "Authentication succeeded";
		token?: string;
		description?: never;
		information?: never;
	}
	| {
		code: 403;
		details: "Authentication failed";
		token?: never;
		description: string;
		information: string;
	};

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
	query: string;
};

/////////////////////////////////////
//////////   PATCH TYPES   //////////
/////////////////////////////////////

type BasePatch = {
	path: string;
};

export type AddPatch = BasePatch & {
	op: "add";
	value: unknown;
};

export type RemovePatch = BasePatch & {
	op: "remove";
};

export type ReplacePatch = BasePatch & {
	op: "replace";
	value: unknown;
};

export type ChangePatch = BasePatch & {
	op: "change";
	value: string;
};

export type Patch = AddPatch | RemovePatch | ReplacePatch | ChangePatch;

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
	id: null;
	method: "notify";
	params: UnprocessedLiveQueryResponse[];
};
