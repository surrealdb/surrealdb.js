import type { components } from "./types/generated.js";

/**
 * The pagination block every Spectron list surface returns beside its rows.
 *
 * `nextCursor` is the only reliable end-of-walk signal: it is absent on the last
 * page. `totalSize` is present only when the request asked for it with
 * `count: true`, which costs a full count of the filtered set.
 */
export type PageMeta = components["schemas"]["PageMeta"];

/** The three pagination parameters every list surface accepts. */
export interface PageOptions {
    /**
     * Page size. Omitted means the server default (100); a value above the cap
     * (500) is clamped rather than rejected, so a caller cannot widen a page by
     * asking for more.
     */
    limit?: number;
    /** Continuation token from the previous page's `page.nextCursor`. */
    cursor?: string;
    /**
     * Also compute `page.totalSize`. Off by default because it scans the whole
     * filtered set — the unbounded read pagination exists to remove.
     */
    count?: boolean;
}

/** A list response: the rows under their collection key, plus the page block. */
type PagedResponse<K extends string, T> = { [P in K]: T[] } & { page: PageMeta };

/**
 * Copies the pagination parameters a caller supplied into a query object,
 * leaving absent ones absent so the server applies its own defaults.
 */
export function addPageParams(query: Record<string, unknown>, options?: PageOptions): void {
    if (options?.limit !== undefined) query.limit = options.limit;
    if (options?.cursor !== undefined) query.cursor = options.cursor;
    if (options?.count !== undefined) query.count = options.count;
}

/**
 * Yields every page of a listing, following `page.nextCursor` to exhaustion.
 *
 * `fetchPage` receives the cursor to resume from — `undefined` on the first
 * call — and must pass it through to the underlying request unchanged.
 */
export async function* walkPages<K extends string, T>(
    fetchPage: (cursor: string | undefined) => Promise<PagedResponse<K, T>>,
    collection: K,
): AsyncGenerator<PagedResponse<K, T>, void, undefined> {
    let cursor: string | undefined;
    const seen = new Set<string>();

    for (;;) {
        const response = await fetchPage(cursor);
        // An empty body (a `204`, or a proxy that drops one) carries no rows and
        // no cursor, so it ends the walk rather than being yielded as a page.
        if (response === null || response === undefined) return;
        yield response;

        // Terminate on the token, never on a short page: a page bounded in the
        // database and then filtered for visibility (`/scopes`, `/keys`) can
        // return fewer rows than `limit` while more pages remain.
        const next = response.page?.nextCursor;
        if (next === undefined || next === null || next === "") return;

        // A cursor that repeats means the server is not advancing, and following
        // it would spin forever. Fail loudly rather than hang or truncate.
        if (seen.has(next)) {
            throw new Error(
                `Spectron returned a repeated pagination cursor while walking \`${collection}\`; the page walk cannot advance.`,
            );
        }
        seen.add(next);
        cursor = next;
    }
}

/**
 * Follows a listing's cursors to exhaustion and returns every row.
 *
 * This is what the `spectron` CLI does for verbs that print a whole set, and
 * what a caller wants when the collection is a tree or a filter source rather
 * than a screenful. Without `max` it is an unbounded read by construction:
 * prefer the page-at-a-time `list` for anything user-facing and large.
 *
 * `max` stops the walk once that many rows are in hand, so a caller that only
 * ever renders the first N does not pay for the pages beyond them. The result
 * can still overshoot `max` by up to one page, because pages arrive whole.
 */
export async function collectPages<K extends string, T>(
    fetchPage: (cursor: string | undefined) => Promise<PagedResponse<K, T>>,
    collection: K,
    max?: number,
): Promise<T[]> {
    const rows: T[] = [];
    for await (const page of walkPages(fetchPage, collection)) {
        const items = page[collection] as T[] | undefined;
        if (items) rows.push(...items);
        if (max !== undefined && rows.length >= max) break;
    }
    return rows;
}
