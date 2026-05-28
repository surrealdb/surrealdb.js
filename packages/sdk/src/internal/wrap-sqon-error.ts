import { SqonError } from "@surrealdb/sqon";
import { SurrealSqonError } from "../errors";

/**
 * Execute a function and wrap any thrown {@link SqonError} in a {@link SurrealSqonError}.
 */
export function wrapSqonError<T>(fn: () => T): T {
    try {
        return fn();
    } catch (error) {
        if (error instanceof SqonError) {
            throw new SurrealSqonError(error);
        }

        throw error;
    }
}
