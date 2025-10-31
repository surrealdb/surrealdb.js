import type { Session } from "./surreal";

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

export type SystemAuth = RootAuth | NamespaceAuth | DatabaseAuth;
export type AccessAuth = AccessSystemAuth | AccessBearerAuth | AccessRecordAuth;
export type AnyAuth = SystemAuth | AccessAuth;

export type Token = string;
export type AuthOrToken = AnyAuth | Token;
export type AuthCallable = (session: Session) => SystemAuth | Token | Promise<SystemAuth | Token>;
export type AuthProvider = SystemAuth | Token | AuthCallable;

export type Tokens = {
    access: Token;
    refresh?: Token;
};
