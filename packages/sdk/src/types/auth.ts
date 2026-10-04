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
 * How long a credential resolved for a request may be reused instead of invoking the
 * resolver again.
 *
 * - `"until-expiry"` reuses a token until shortly before the `exp` claim of the JWT expires, as
 *   governed by the `expiryMargin` connect option. A token without a known expiry, such as an
 *   opaque token, cannot be reused safely and is resolved again for every request.
 * - `"none"` always invokes the resolver for a request.
 * - `{ ttl }` reuses a credential for at most `ttl` seconds, and no longer than the expiry of
 *   a token which carries one. It is the way to bound the reuse of tokens without an expiry.
 */
export type AuthCache = "until-expiry" | "none" | { ttl: number };

/**
 * Computes credentials when the connection is established or re-established, and again
 * when the session is about to expire.
 */
export interface AuthResolverOnConnect {
    resolve: AuthCallable;
    when?: "connect";
    cache?: never;
}

/**
 * Computes credentials as requests are made, rather than when connecting.
 */
export interface AuthResolverOnRequest {
    resolve: AuthCallable;
    when: "request";
    cache?: AuthCache;
}

/**
 * An authentication resolver, which allows configuring when its function is evaluated.
 */
export type AuthResolver = AuthResolverOnConnect | AuthResolverOnRequest;

/**
 * Authentication details, a token, a function computing either, or a resolver.
 */
export type AuthProvider = ProvidedAuth | AuthCallable | AuthResolver;

export type Tokens = {
    access: Token;
    refresh?: Token;
};
