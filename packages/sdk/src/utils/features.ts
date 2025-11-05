import { Feature } from "../internal/feature";

/**
 * Available features which may be supported by specific
 * engines or versions of SurrealDB.
 */
export const Features = Object.freeze({
    LiveQueries: new Feature("live-queries"),
    Sessions: new Feature("sessions", "3.0.0"),
    RefreshTokens: new Feature("refresh-tokens", "3.0.0"),
    Transactions: new Feature("transactions", "3.0.0"),
});
