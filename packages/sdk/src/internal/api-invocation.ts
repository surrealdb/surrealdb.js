import type { ApiRequest } from "../api/api";
import type { BoundQuery } from "../utils/bound-query";
import { surql } from "../utils/tagged-template";

/**
 * The `api::invoke` query which invokes a custom API inside the datastore, for engines which
 * have no other way to, and for an API call compiled or streamed as a query.
 */
export function apiInvocation<R extends unknown[]>(
    path: string,
    { body, method, headers, query }: ApiRequest<unknown>,
): BoundQuery<R> {
    return surql<R>`api::invoke(${path}, ${{ body, method, headers, query }})`;
}
