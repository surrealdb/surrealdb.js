import { ExpressionError } from "../errors";
import { getIncrementalID } from "../internal/get-incremental-id";
import type { Expr, ExprCtx, ExprLike } from "../types";
import { BoundQuery } from "./bound-query";

const _join = (xs: ExprLike[], op: "AND" | "OR"): Expr => ({
    toSQL: (ctx) => {
        const parts = xs
            .filter(Boolean)
            .map((e) => (e as Expr).toSQL(ctx))
            .filter(Boolean);
        if (!parts.length) return "";
        if (parts.length === 1) return parts[0];
        return `(${parts.join(` ${op} `)})`;
    },
});

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

/**
 * Represents a raw SurrealQL expression
 *
 * **IMPORTANT**: This function should only be used when no other operator is applicable.
 * Incorrect use of this function will risk exposing queries to SQL injection.
 *
 * @param s The raw value
 */
export const raw = (s: string): Expr => ({
    toSQL: () => s,
});

// Operators

/**
 * Represents a equality comparison operation (=)
 *
 * @param field The field name
 * @param v The value to compare against
 */
export const eq = (field: string, v: unknown): Expr => ({
    toSQL: (ctx) => `${field} = ${ctx.def(v)}`,
});

/**
 * Represents an exact equality comparison operation (==)
 *
 * @param field The field name
 * @param v The value to compare against
 */
export const eeq = (field: string, v: unknown): Expr => ({
    toSQL: (ctx) => `${field} == ${ctx.def(v)}`,
});

/**
 * Represents a not equal comparison operation (!=)
 *
 * @param field The field name
 * @param v The value to compare against
 */
export const ne = (field: string, v: unknown): Expr => ({
    toSQL: (ctx) => `${field} != ${ctx.def(v)}`,
});

/**
 * Represents a greater than comparison operation (>)
 *
 * @param field The field name
 * @param v The value to compare against
 */
export const gt = (field: string, v: unknown): Expr => ({
    toSQL: (ctx) => `${field} > ${ctx.def(v)}`,
});

/**
 * Represents a greater than or equal to comparison operation (>=)
 *
 * @param field The field name
 * @param v The value to compare against
 */
export const gte = (field: string, v: unknown): Expr => ({
    toSQL: (ctx) => `${field} >= ${ctx.def(v)}`,
});

/**
 * Represents a less than comparison operation (<)
 *
 * @param field The field name
 * @param v The value to compare against
 */
export const lt = (field: string, v: unknown): Expr => ({
    toSQL: (ctx) => `${field} < ${ctx.def(v)}`,
});

/**
 * Represents a less than or equal to comparison operation (<=)
 *
 * @param field The field name
 * @param v The value to compare against
 */
export const lte = (field: string, v: unknown): Expr => ({
    toSQL: (ctx) => `${field} <= ${ctx.def(v)}`,
});

/**
 * Represents a contains operation (CONTAINS)
 *
 * @param field The field name
 * @param v The value to compare against
 */
export const contains = (field: string, v: unknown): Expr => ({
    toSQL: (ctx) => `${field} CONTAINS ${ctx.def(v)}`,
});

/**
 * Represents a contains any operation (CONTAINSANY)
 *
 * @param field The field name
 * @param v The value to compare against
 */
export const containsAny = (field: string, v: unknown): Expr => ({
    toSQL: (ctx) => `${field} CONTAINSANY ${ctx.def(v)}`,
});

/**
 * Represents a contains all operation (CONTAINSALL)
 *
 * @param field The field name
 * @param v The value to compare against
 */
export const containsAll = (field: string, v: unknown): Expr => ({
    toSQL: (ctx) => `${field} CONTAINSALL ${ctx.def(v)}`,
});

/**
 * Represents a contains none operation (CONTAINSNONE)
 *
 * @param field The field name
 * @param v The value to compare against
 */
export const containsNone = (field: string, v: unknown): Expr => ({
    toSQL: (ctx) => `${field} CONTAINSNONE ${ctx.def(v)}`,
});

/**
 * Represents an inside operation (INSIDE)
 *
 * @param field The field name
 * @param v The value to compare against
 */
export const inside = (field: string, v: unknown): Expr => ({
    toSQL: (ctx) => `${field} INSIDE ${ctx.def(v)}`,
});

/**
 * Represents a geometry outside operation (OUTSIDE)
 *
 * @param field The field name
 * @param g The value to compare against
 */
export const outside = (field: string, g: unknown): Expr => ({
    toSQL: (ctx) => `${field} OUTSIDE ${ctx.def(g)}`,
});

/**
 * Represents a geometry intersects operation (INTERSECTS)
 *
 * @param field The field name
 * @param g The value to compare against
 */
export const intersects = (field: string, g: unknown): Expr => ({
    toSQL: (ctx) => `${field} INTERSECTS ${ctx.def(g)}`,
});

/**
 * Represents a full-text search match operation (@@)
 *
 * @param field The field name
 * @param q The value to compare against
 * @param ref The optional reference number
 */
export const matches = (field: string, q: string, ref?: number): Expr => ({
    toSQL: (ctx) => `${field} ${Number.isInteger(ref) ? `@${ref}@` : "@@"} ${ctx.def(q)}`,
});

/**
 * Represents a KNN nearest neighbor operation
 *
 * Supported operations include:
 * - Brute Force: <|n,metric|>, where n is the number of neighbors and metric is the metric to use
 * - MTree: <|n|>, where n is the number of neighbors
 * - HNSW: <|n,ef|>, where n is the number of neighbors and ef is the ef
 *
 * @param field The field name
 * @param v The value to compare against
 * @param neighbors The number of neighbors
 * @param metricOrEf The optional metric or ef
 */
export const knn = (
    field: string,
    v: unknown,
    neighbors: number,
    metricOrEf?: string | number,
): Expr => ({
    toSQL: (ctx) => {
        if (!Number.isInteger(neighbors)) {
            throw new ExpressionError("neighbors must be an integer");
        }

        if (
            metricOrEf !== undefined &&
            !Number.isInteger(metricOrEf) &&
            !/\w+/.test(metricOrEf as string)
        ) {
            throw new ExpressionError("metric is invalid");
        }

        return `${field} <|${neighbors}${metricOrEf ? `,${metricOrEf}` : ""}|> ${ctx.def(v)}`;
    },
});

/**
 * Represents a between operation. This is a shortcut for `and(gte(field, a), lte(field, b))`
 *
 * @param field The field name
 * @param a The lower bound
 * @param b The upper bound
 */
export const between = (field: string, a: unknown, b: unknown): Expr => ({
    toSQL: (ctx) => and(gte(field, a), lte(field, b)).toSQL(ctx),
});

/**
 * Represents a logical AND operation
 *
 * @param exprs The expressions to join
 * @returns A new expression
 */
export const and = (...exprs: ExprLike[]) => _join(exprs, "AND");

/**
 * Represents a logical OR operation
 *
 * @param exprs The expressions to join
 * @returns A new expression
 */
export const or = (...exprs: ExprLike[]) => _join(exprs, "OR");

/**
 * Represents a logical NOT operation
 *
 * @param expr The expression to negate
 * @returns A new expression
 */
export const not = (expr: ExprLike): Expr => ({
    toSQL: (ctx) => {
        const s = expr && (expr as Expr).toSQL(ctx);
        return s ? `NOT(${s})` : "";
    },
});
