export type ConnectionStrategy = 'websocket';
export interface Connection {
	constructor: Constructor<
		(url: string, prepare?: (connection: Connection) => unknown) => void
	>;

	connect: (url: string, prepare?: () => unknown) => void;
	ping: () => Promise<void>;
	use: (ns: string, db: string) => Promise<void>;
	info: () => Promise<void>;

	signup: (vars: ScopeAuth) => Promise<Token>;
	signin: (vars: AnyAuth) => Promise<Token>;
	authenticate: (token: Token) => Promise<void>;
	invalidate: () => Promise<void>;

	let: (variable: string, value: unknown) => Promise<string>;

	query: <T extends RawQueryResult[]>(
		query: string,
		vars?: Record<string, unknown>
	) => Promise<MapResult<T>>;

	select: <T, RID extends string>(
		thing: RID
	) => Promise<ReturnsThing<T, RID>>;

	create: <T extends Record<string, unknown>>(
		thing: string,
		data?: T
	) => Promise<T & { id: Thing }>;

	update: <T extends Record<string, unknown>, RID extends string>(
		thing: RID,
		data?: T
	) => Promise<ReturnsThing<T & { id: Thing }, RID>>;

	change: <
		T extends Record<string, unknown>,
		U extends Record<string, unknown> = T,
		RID extends string | void = void
	>(
		thing: Exclude<RID, void>,
		data?: Partial<T> & U
	) => Promise<ReturnsThing<T & U & { id: string }, Exclude<RID, void>>>;

	modify: <RID extends string>(
		thing: RID,
		data?: Patch[]
	) => Promise<ReturnsThing<Patch, RID>>;

	delete: (thing: string) => Promise<void>;
}

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

export type MapResult<T> = {
	[K in keyof T]: Result<T[K]>;
};

export type Thing<
	T extends string = string,
	U extends string = string
> = `${T}:${U}`;

export type ReturnsThing<T, RID extends string> = RID extends Thing ? T : T[];
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

///////////////////////////////
//////////   OTHER   //////////
///////////////////////////////

// deno-lint-ignore ban-types
type Constructor<T> = Function & { prototype: T };

export type RawSocketMessageResponse =
	| (Result & { id: number })
	| RawSocketLiveQueryNotification;
export type RawSocketLiveQueryNotification = {
	id: null;
	method: "notify";
	params: unknown[];
};
