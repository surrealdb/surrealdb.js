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

/**
 * The credentials an authentication provider may supply:
 *
 * - an access token, which is used as is,
 * - any authentication details accepted by `signin()`, which are exchanged for a token,
 *   including record access `variables`, a bearer access `key`, and a system user
 *   signing in through an `access` method, or
 * - `null` for no authentication.
 */
export type ProvidedAuth = AnyAuth | Token | null;

/**
 * A function computing the credentials for a session. It may be asynchronous.
 */
export type AuthCallable = (session: Session) => ProvidedAuth | Promise<ProvidedAuth>;

/**
 * Authentication details, a token, or a function computing either.
 */
export type AuthProvider = ProvidedAuth | AuthCallable;

export type Tokens = {
    access: Token;
    refresh?: Token;
};
