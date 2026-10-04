import { AuthResolverError, SurrealError } from "../errors";
import type { AuthCache, AuthCallable, AuthProvider, ProvidedAuth, Session } from "../types";
import { assertAuthCache } from "./request-credentials";

export interface ParsedAuthentication {
    /** Credentials applied when connecting, and again when they are about to expire */
    provider: ProvidedAuth | AuthCallable | undefined;
    /** Credentials resolved as requests are made */
    request: { resolve: AuthCallable; cache: AuthCache } | undefined;
}

/**
 * Tell apart the ways in which authentication may be provided to a connection.
 */
export function parseAuthentication(
    authentication: AuthProvider | undefined,
): ParsedAuthentication {
    if (
        typeof authentication === "object" &&
        authentication !== null &&
        "resolve" in authentication
    ) {
        if (typeof authentication.resolve !== "function") {
            throw new SurrealError("The authentication resolver must be a function");
        }

        if (authentication.when === "request") {
            const cache = authentication.cache ?? "until-expiry";

            // Reported when connecting rather than on the first request
            assertAuthCache(cache);

            return { provider: undefined, request: { resolve: authentication.resolve, cache } };
        }

        if (authentication.when !== undefined && authentication.when !== "connect") {
            throw new SurrealError(
                'The authentication resolver must be evaluated on "connect" or on "request"',
            );
        }

        return { provider: authentication.resolve, request: undefined };
    }

    return { provider: authentication, request: undefined };
}

/**
 * Evaluate the authentication provider for a session. A provider which throws, or which
 * returns something which cannot be used, is reported as an `AuthResolverError`. What was
 * returned is never included, as it may be a credential.
 */
export async function invokeProvider(
    provider: ProvidedAuth | AuthCallable,
    session: Session,
): Promise<ProvidedAuth> {
    let provided: unknown;

    try {
        provided = typeof provider === "function" ? await provider(session) : provider;
    } catch (error) {
        throw new AuthResolverError(error);
    }

    if (
        provided === null ||
        (typeof provided === "string" && provided.length > 0) ||
        (typeof provided === "object" && !Array.isArray(provided))
    ) {
        return provided as ProvidedAuth;
    }

    throw new AuthResolverError(
        new TypeError(
            `Expected a token, authentication details or null, but received ${describeValue(provided)}`,
        ),
    );
}

/**
 * Describe the kind of a value which was not acceptable, without repeating the value, as it
 * may be a credential.
 */
function describeValue(value: unknown): string {
    if (value === null) return "null";
    if (Array.isArray(value)) return "an array";
    if (typeof value === "string") return "an empty string";

    return `a value of type ${typeof value}`;
}
