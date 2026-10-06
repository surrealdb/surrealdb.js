import { addPageParams, collectPages, type PageOptions } from "../pagination.js";
import { encodePathSegment, getContextApiPrefix } from "../paths.js";
import type { Transport } from "../transport.js";
import type { EntityRanking } from "../types/domain.js";
import type { components } from "../types/generated.js";

export type EntityDetailJson = components["schemas"]["EntityDetailJson"];
export type EntityListResponseJson = components["schemas"]["EntityListResponseJson"];
export type EntityResponseJson = components["schemas"]["EntityResponseJson"];
export type EntityHistoryResponseJson = components["schemas"]["EntityHistoryResponseJson"];
export type EntityHistoryAllResponseJson = components["schemas"]["EntityHistoryAllResponseJson"];
export type EntityTruncationJson = components["schemas"]["EntityTruncationJson"];
export type EntitySearchResponseJson = components["schemas"]["EntitySearchResponseJson"];
export type TopEntitiesResponseJson = components["schemas"]["TopEntitiesResponseJson"];
export type EntityMatchJson = components["schemas"]["EntityMatchJson"];
export type NeighbourJson = components["schemas"]["NeighbourJson"];
export type NeighbourhoodResponseJson = components["schemas"]["NeighbourhoodResponseJson"];
export type AttributeDetailJson = components["schemas"]["AttributeDetailJson"];

/** The temporal filters the fact reads accept. */
export interface TemporalOptions {
    /** Known-time: read the facts as they stood at this instant. */
    asOf?: string;
    /** Read through MVCC at this instant. */
    atInstant?: string;
    /** World-time lower bound. */
    validFrom?: string;
    /** World-time upper bound. */
    validUntil?: string;
}

/** Options for {@link Entities.get}. */
export interface EntityGetOptions extends TemporalOptions {
    /**
     * Max rows per fact section (default 500, which is also the cap).
     *
     * Both sections are a bounded head, not the whole set: check
     * `truncated.attributes` / `truncated.relations` and walk the section's own
     * collection endpoint when either is set.
     */
    limit?: number;
}

/** Options for {@link Entities.search}. */
export interface EntitySearchOptions {
    /** Restrict to one entity type. */
    type?: string;
    /** Max matches (default 10, capped by the server's list limit). */
    limit?: number;
}

/** Options for {@link Entities.top}. */
export interface TopEntitiesOptions {
    /** Ordering. Defaults to `coverage`. */
    by?: EntityRanking | string;
    /** Restrict to one entity type. */
    type?: string;
    /** Max entities (default 10). */
    limit?: number;
}

/**
 * Options for {@link Entities.neighbours}.
 *
 * `count` and `minFacts` are an exclusive union because the server rejects the
 * pairing with a `400`: honouring the filter in a total would cost the
 * per-neighbour counts this walk exists to avoid. The invalid combination fails
 * to type-check rather than surfacing at runtime.
 */
export type NeighbourhoodOptions =
    | (PageOptions & { minFacts?: never })
    | (Omit<PageOptions, "count"> & { minFacts?: number; count?: never });

/** Options for {@link Entities.changes}. */
export type EntityChangesOptions = PageOptions;

/** Entity records, attributes, relations, name search, and attribute history. */
export class Entities {
    private readonly transport: Transport;

    private readonly contextId: string;

    constructor(transport: Transport, contextId: string) {
        this.transport = transport;
        this.contextId = contextId;
    }

    private get base(): string {
        return `${getContextApiPrefix(this.contextId)}/entities`;
    }

    private entityPath(entityType: string, name: string): string {
        return `${this.base}/${encodePathSegment(entityType)}/${encodePathSegment(name)}`;
    }

    /** Lists one page of entities, optionally filtered by type. */
    async list(options?: PageOptions & { type?: string }): Promise<EntityListResponseJson> {
        const query: Record<string, unknown> = {};
        if (options?.type !== undefined) query.type = options.type;
        addPageParams(query, options);
        const body = await this.transport.requestJson("GET", this.base, { query });
        return body as EntityListResponseJson;
    }

    /** Every matching entity, following cursors to exhaustion. */
    async listAll(options?: { type?: string; limit?: number }): Promise<EntityDetailJson[]> {
        return collectPages(
            (cursor) => this.list({ type: options?.type, limit: options?.limit, cursor }),
            "entities",
        );
    }

    /**
     * How many entities match, without fetching them.
     *
     * Asks for a single row with `count: true`, so the total is the only thing
     * paid for beyond one page bound.
     */
    async count(options?: { type?: string }): Promise<number> {
        const page = await this.list({ type: options?.type, limit: 1, count: true });
        return page.page.totalSize ?? page.entities.length;
    }

    /**
     * Searches entities by name, best match first (`GET /entities/search`).
     *
     * Lexical and deterministic: no model and no vector index in the path, so
     * an identical query returns identical rows in an identical order. An exact
     * match on the normalised identity name scores `1.0` and everything else
     * strictly below it, corpus-independently — a score means the same thing in
     * a context of ten entities and one of ten million.
     *
     * Each match carries its own `factCount` and a `distinguisher` drawn from
     * its highest-importance facts, so two same-named candidates can be told
     * apart without a request per candidate.
     *
     * This is a ranked head, not a walk: it is bounded by `limit` and offers no
     * cursor. Use {@link Entities.list} to enumerate the collection.
     */
    async search(query: string, options?: EntitySearchOptions): Promise<EntityMatchJson[]> {
        const params: Record<string, unknown> = { q: query };
        if (options?.type !== undefined) params.type = options.type;
        if (options?.limit !== undefined) params.limit = options.limit;
        const body = await this.transport.requestJson("GET", `${this.base}/search`, {
            query: params,
        });
        return (body as EntitySearchResponseJson).matches;
    }

    /**
     * The entities worth starting from (`GET /entities/top`).
     *
     * `coverage` (the default) is most-known-about, the one ordering the entity
     * listing cannot express. It is exact rather than approximated, and costs
     * an aggregate pass per fact family: merging three separately-truncated
     * top-lists would mis-rank an entity that leads on relations and trails on
     * attributes. Prefer `importance` or `recency`, both index-served
     * single-table reads, where the ranking need not be exact.
     *
     * A ranked head, like {@link Entities.search}: bounded, with no cursor.
     */
    async top(options?: TopEntitiesOptions): Promise<EntityMatchJson[]> {
        const params: Record<string, unknown> = {};
        if (options?.by !== undefined) params.by = options.by;
        if (options?.type !== undefined) params.type = options.type;
        if (options?.limit !== undefined) params.limit = options.limit;
        const body = await this.transport.requestJson("GET", `${this.base}/top`, { query: params });
        return (body as TopEntitiesResponseJson).entities;
    }

    /**
     * Fetches a single entity with a bounded head of its attributes and
     * relations, newest first.
     *
     * Both fact sections are bounded by `limit` and report whether they were
     * cut in `truncated`. To read one in full, walk its own collection: the
     * attributes through `/attributes?entity=`, and the relations through
     * **both** `/relations?src=` and `/relations?dst=`, because the head
     * carries edges in either direction and one filter alone reproduces half of
     * it. All of them page by cursor in this same order, so the head is a
     * genuine prefix of the walk.
     */
    async get(
        entityType: string,
        name: string,
        options?: EntityGetOptions,
    ): Promise<EntityResponseJson> {
        const query: Record<string, unknown> = {};
        if (options?.limit !== undefined) query.limit = options.limit;
        addTemporalParams(query, options);
        const body = await this.transport.requestJson("GET", this.entityPath(entityType, name), {
            query,
        });
        return body as EntityResponseJson;
    }

    /**
     * One hop out from an entity (`GET /entities/{type}/{name}/neighbourhood`).
     *
     * Each neighbour carries its own `factCount`, so a relation chip is
     * navigable rather than decorative — without it a caller needs one request
     * per chip. Paginated over the edge's own `(createdAt, id)`, never the fact
     * count, which moves under ingest.
     *
     * `limit` is capped below the general list limit because each row costs
     * three correlated counts.
     */
    async neighbours(
        entityType: string,
        name: string,
        options?: NeighbourhoodOptions,
    ): Promise<NeighbourhoodResponseJson> {
        const query: Record<string, unknown> = {};
        if (options?.minFacts !== undefined) query.minFacts = options.minFacts;
        addPageParams(query, options);
        const body = await this.transport.requestJson(
            "GET",
            `${this.entityPath(entityType, name)}/neighbourhood`,
            { query },
        );
        return body as NeighbourhoodResponseJson;
    }

    /** Every neighbour of an entity, following cursors to exhaustion. */
    async allNeighbours(
        entityType: string,
        name: string,
        options?: { minFacts?: number; limit?: number; max?: number },
    ): Promise<NeighbourJson[]> {
        return collectPages(
            (cursor) =>
                this.neighbours(entityType, name, {
                    minFacts: options?.minFacts,
                    limit: options?.limit,
                    cursor,
                }),
            "neighbours",
            options?.max,
        );
    }

    /**
     * One page of every key's supersession chain for an entity, newest first
     * (`GET /entities/{type}/{name}/history`).
     *
     * Answers what changed about the subject. The per-key sibling,
     * {@link Entities.history}, answers how one value changed, and this cannot
     * be composed from it without a request per key. Superseded rows are
     * included — the chain is the point.
     */
    async changes(
        entityType: string,
        name: string,
        options?: EntityChangesOptions,
    ): Promise<EntityHistoryAllResponseJson> {
        const query: Record<string, unknown> = {};
        addPageParams(query, options);
        const body = await this.transport.requestJson(
            "GET",
            `${this.entityPath(entityType, name)}/history`,
            { query },
        );
        return body as EntityHistoryAllResponseJson;
    }

    /**
     * The subject's whole change history, following cursors to exhaustion.
     *
     * Unbounded by construction: an attribute revised on every sync has an
     * unbounded chain. Pass `max` to stop the walk once that many rows are in
     * hand.
     */
    async allChanges(
        entityType: string,
        name: string,
        options?: { limit?: number; max?: number },
    ): Promise<AttributeDetailJson[]> {
        return collectPages(
            (cursor) => this.changes(entityType, name, { limit: options?.limit, cursor }),
            "history",
            options?.max,
        );
    }

    /** Returns the supersession history for one attribute key. */
    async history(entityType: string, name: string, key: string): Promise<AttributeDetailJson[]> {
        const path = `${this.entityPath(entityType, name)}/history/${encodePathSegment(key)}`;
        const body = await this.transport.requestJson("GET", path);
        return (body as EntityHistoryResponseJson).history;
    }

    /** Soft-deletes an entity (sets valid-until). */
    async delete(entityType: string, name: string): Promise<void> {
        await this.transport.requestJson("DELETE", this.entityPath(entityType, name));
    }
}

/** Copies the temporal filters a caller supplied into a query object. */
function addTemporalParams(query: Record<string, unknown>, options?: TemporalOptions): void {
    if (options?.asOf !== undefined) query.asOf = options.asOf;
    if (options?.atInstant !== undefined) query.atInstant = options.atInstant;
    if (options?.validFrom !== undefined) query.validFrom = options.validFrom;
    if (options?.validUntil !== undefined) query.validUntil = options.validUntil;
}
