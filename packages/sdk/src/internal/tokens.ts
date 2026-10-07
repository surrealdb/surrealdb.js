export function fastParseJwt(token: string) {
    try {
        const parts = token.split(".");

        if (parts.length !== 3) {
            return null;
        }

        return JSON.parse(atob(parts[1]));
    } catch {
        return null;
    }
}

/**
 * Read the expiry of a JWT, in seconds since the epoch. Returns undefined for a token which
 * is not a JWT, such as an opaque token, or which carries no usable `exp` claim.
 */
export function tokenExpiry(token: string): number | undefined {
    const exp = fastParseJwt(token)?.exp;

    return typeof exp === "number" && Number.isFinite(exp) ? exp : undefined;
}

/**
 * How long, in seconds, to wait before renewing a credential which has `remaining` seconds
 * left. The renewal happens `margin` seconds before expiry, unless the credential does not
 * live much longer than the margin, in which case the margin is skipped and the expiry is used.
 */
export function renewalDelay(remaining: number, margin: number): number {
    return Math.min(remaining, Math.max(remaining - margin, margin));
}
