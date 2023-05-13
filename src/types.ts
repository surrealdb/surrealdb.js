export type ConnectionStrategy = "websocket" | "experimental_http";
export interface Connection {
	constructor: Constructor<
		(url?: string, options?: ConnectionOptions) => void
	>;

	connect: (url: string, options?: ConnectionOptions) => void;
	ping: () => Promise<void>;
	use: (ns: string, db: string) => MaybePromise<void>;
	info?: () => Promise<void>;

	signup: (vars: ScopeAuth) => Promise<Token>;
	signin: (vars: AnyAuth) => Promise<Token | void>;
	authenticate: (token: Token) => MaybePromise<void>;
	invalidate: () => MaybePromise<void>;

	let?: (variable: string, value: unknown) => Promise<string>;

	query: <T extends RawQueryResult[]>(
		query: string,
		vars?: Record<string, unknown>,
	) => Promise<MapQueryResult<T>>;

	select?:
		| (<T extends Record<string, unknown>>(table: Table) => Promise<T[]>)
		| (<T extends Record<string, unknown>>(record: RecordId) => Promise<T>);

	create?:
		| (<T extends Record<string, unknown>>(
			table: Table,
			data?: T,
		) => Promise<T & { id: string }>)
		| (<T extends Record<string, unknown>>(
			record: RecordId,
			data?: T,
		) => Promise<T & { id: string }>);

	update?: // Update
		| (<T extends Record<string, unknown>>(
			table: Table,
		) => Promise<(T & { id: string })[]>)
		| (<T extends Record<string, unknown>>(
			record: RecordId,
		) => Promise<T & { id: string }>)
		// Content
		| (<T extends Record<string, unknown>>(
			table: Table,
			options: {
				content: T;
			},
		) => Promise<(T & { id: string })[]>)
		| (<T extends Record<string, unknown>>(
			record: RecordId,
			options: {
				content: T;
			},
		) => Promise<T & { id: string }>)
		// Merge
		| (<
			T extends Record<string, unknown>,
			U extends Record<string, unknown> = T,
		>(
			table: Table,
			options: {
				merge: Partial<T> & U;
			},
		) => Promise<(T & U & { id: string })[]>)
		| (<
			T extends Record<string, unknown>,
			U extends Record<string, unknown> = T,
		>(
			record: RecordId,
			options: {
				merge: Partial<T> & U;
			},
		) => Promise<T & U & { id: string }>)
		// Patch
		| ((
			table: Table,
			options: {
				patch: Patch[];
			},
		) => Promise<Patch[]>)
		| ((
			record: RecordId,
			options: {
				patch: Patch[];
			},
		) => Promise<Patch>);

	delete?:
		| ((table: Table) => Promise<void>)
		| ((record: RecordId) => Promise<void>);
}

export type UpdateOptions<
	T extends Record<string, unknown>,
	U extends Record<string, unknown> = T,
> = {
	content?: never;
	merge?: never;
	patch?: never;
} | {
	content: T;
	merge?: never;
	patch?: never;
} | {
	content?: never;
	merge: Partial<T> & U;
	patch?: never;
} | {
	content?: never;
	merge?: never;
	patch: Patch[];
};

export type ConnectionOptions = {
	prepare?: (connection: Connection) => unknown;
};

export type HTTPConnectionOptions<TFetcher = typeof fetch> =
	& ConnectionOptions
	& {
		fetch?: TFetcher;
	};

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

/////////////////////////////////////
//////////   QUERY TYPES   //////////
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
	params: unknown[];
};

export type Table = string;
export type RecordId = [string, string];
export type Thing = Table | RecordId;
