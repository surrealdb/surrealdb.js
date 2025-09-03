/**
 * The context for building SurrealQL expressions
 */
export interface ExprCtx {
    def: (value: unknown) => string;
}

/**
 * Represents a single SurrealQL expression
 */
export interface Expr {
    toSQL(ctx: ExprCtx): string;
}

/**
 * Any value which may represent an expression
 */
export type ExprLike = Expr | null | undefined | false;
