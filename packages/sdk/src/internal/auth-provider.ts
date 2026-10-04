import { AuthResolverError } from "../errors";
import type { AuthCallable, ProvidedAuth, Session } from "../types";

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
