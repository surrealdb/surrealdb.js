import { ExpressionError } from "../errors";
import { getIncrementalID } from "../internal/get-incremental-id";
import type { Expr, ExprCtx, ExprLike } from "../types";
import { BoundQuery } from "./bound-query";

/**
 * Parse a SurrealQL expression to a BoundQuery
 *
 * @param expr The SurrealQL expression
 * @returns A BoundQuery instance
 */
export function expr(expr: ExprLike): BoundQuery {
    const params: Record<string, unknown> = {};
    const ctx: ExprCtx = {
        def(value) {
            const bindingName = `bind__${getIncrementalID()}`;
            params[bindingName] = value;
            return `$${bindingName}`;
        },
    };

    try {
        return new BoundQuery(expr ? (expr as Expr).toSQL(ctx) : "", params);
    } catch (error) {
        throw new ExpressionError(error);
    }
}
