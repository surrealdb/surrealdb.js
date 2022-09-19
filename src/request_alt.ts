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

export interface SurrealQLRequest<
	TMethod extends SurrealQLMethod = SurrealQLMethod,
> {
	id: string;
	method: TMethod;
}

export interface SurrealQLRequestPing
	extends SurrealQLRequest<SurrealQLMethod.ping> {
	params: [];
}
export interface SurrealQLRequestInfo
	extends SurrealQLRequest<SurrealQLMethod.info> {
	params: [];
}
export interface SurrealQLRequestUse
	extends SurrealQLRequest<SurrealQLMethod.use> {
	params: [NAMESPACE | undefined, DB | undefined];
}
export interface SurrealQLRequestSignup
	extends SurrealQLRequest<SurrealQLMethod.signup> {
	params: [Record<string, unknown>];
}
export interface SurrealQLRequestSignin
	extends SurrealQLRequest<SurrealQLMethod.signin> {
	params: [Record<string, unknown>];
}
export interface SurrealQLRequestAuthenticate
	extends SurrealQLRequest<SurrealQLMethod.authenticate> {
	params: [JWT_TOKEN];
}
export interface SurrealQLRequestInvalidate
	extends SurrealQLRequest<SurrealQLMethod.invalidate> {
	params: [];
}
export interface SurrealQLRequestKill
	extends SurrealQLRequest<SurrealQLMethod.kill> {
	params: [UUID];
}
export interface SurrealQLRequestLive
	extends SurrealQLRequest<SurrealQLMethod.live> {
	params: [TABLE_NAME];
}
export interface SurrealQLRequestLet
	extends SurrealQLRequest<SurrealQLMethod.let> {
	params: [PARAM_NAME, JSON];
}
export type SurrealQLRequestset = SurrealQLRequestLet;
export interface SurrealQLRequestQuery
	extends SurrealQLRequest<SurrealQLMethod.query> {
	params: [QUERY_TEXT, QUERY_PARAMS];
}
export interface SurrealQLRequestSelect
	extends SurrealQLRequest<SurrealQLMethod.select> {
	params: [TABLE_NAME | RECORD_ID];
}
export interface SurrealQLRequestCreate<TRecord>
	extends SurrealQLRequest<SurrealQLMethod.create> {
	params: [TABLE_NAME | RECORD_ID, undefined | TRecord];
}
export interface SurrealQLRequestUpdate<TRecord>
	extends SurrealQLRequest<SurrealQLMethod.update> {
	params: [TABLE_NAME | RECORD_ID, undefined | TRecord];
}
export interface SurrealQLRequestChange<TRecord>
	extends SurrealQLRequest<SurrealQLMethod.change> {
	params: [TABLE_NAME | RECORD_ID, undefined | TRecord];
}
export interface SurrealQLRequestModify
	extends SurrealQLRequest<SurrealQLMethod.modify> {
	params: [TABLE_NAME | RECORD_ID, JSON_PATCH[]];
}
export interface SurrealQLRequestDelete
	extends SurrealQLRequest<SurrealQLMethod.delete> {
	params: [TABLE_NAME | RECORD_ID];
}

export type SurrealQLResponsePing = unknown;
export type SurrealQLResponseInfo = unknown;
export type SurrealQLResponseUse = unknown;
export type SurrealQLResponseSignup = unknown;
export type SurrealQLResponseSignin = unknown;
export type SurrealQLResponseAuthenticate = unknown;
export type SurrealQLResponseInvalidate = unknown;
export type SurrealQLResponseKill = unknown;
export type SurrealQLResponseLive = unknown;
export type SurrealQLResponseLet = unknown;
export type SurrealQLResponseSet = SurrealQLMethod.let;
export type SurrealQLResponseQuery = QUERY_RESULT[];
export type SurrealQLResponseSelect = unknown[]; // TODO
export type SurrealQLResponseCreate = unknown[]; // TODO
export type SurrealQLResponseUpdate = unknown[]; // TODO
export type SurrealQLResponseChange = unknown[]; // TODO
export type SurrealQLResponseModify<TRecord> = RECORD_DIFFS<TRecord>[];
export type SurrealQLResponseDelete = Record<never, never>[];

/**
 * Advantages
 * - easier to document each request with TSDoc
 */
