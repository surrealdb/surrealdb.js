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

export type AccessSystemAuth = {
	namespace?: string;
	database?: string;
	username: string;
	password: string;
	access: string;
};

export type AccessBearerAuth = {
	namespace?: string;
	database?: string;
	access: string;
	key: string;
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
	| AccessSystemAuth
	| AccessBearerAuth
	| AccessRecordAuth;

export type Token = string;
export type AuthOrToken = AnyAuth | Token;
export type AuthCallable = () => AuthOrToken | Promise<AuthOrToken>;
export type AuthRenewer = boolean | AuthCallable;
export type AuthProvider = AuthOrToken | AuthCallable;

export type AuthResponse = {
	token: Token;
	refresh?: Token;
};
