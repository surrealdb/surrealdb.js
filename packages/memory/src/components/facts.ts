import { addPageParams, collectPages, type PageOptions } from "../pagination.js";
import { getContextApiPrefix } from "../paths.js";
import type { Transport } from "../transport.js";
import type { components } from "../types/generated.js";

export type AttributeDetailJson = components["schemas"]["AttributeDetailJson"];
export type AttributeListResponseJson = components["schemas"]["AttributeListResponseJson"];
export type RelationDetailJson = components["schemas"]["RelationDetailJson"];
export type RelationListResponseJson = components["schemas"]["RelationListResponseJson"];
export type ActionDetailJson = components["schemas"]["ActionDetailJson"];
export type ActionListResponseJson = components["schemas"]["ActionListResponseJson"];

/** Filters `/attributes` accepts, beside its pagination parameters. */
export interface AttributeFilters {
    /** One entity's attributes, as `<type>/<name>` (e.g. `person/alice`). */
    entity?: string;
    /** One attribute key. */
    key?: string;
}

/** Filters `/relations` accepts, beside its pagination parameters. */
export interface RelationFilters {
    /** Subject entity, as `<type>/<name>`. */
    src?: string;
    /** Object entity, as `<type>/<name>`. */
    dst?: string;
    /** Relation label. */
    label?: string;
}

/** Filters `/actions` accepts, beside its pagination parameters. */
export interface ActionFilters {
    /** Acting entity, as `<type>/<name>`. */
    actor?: string;
    /** Action verb. */
    verb?: string;
    /** Inclusive lower bound on `occurredAt`, as an RFC 3339 timestamp. */
    since?: string;
    /** Inclusive upper bound on `occurredAt`, as an RFC 3339 timestamp. */
    until?: string;
}

export type AttributeListOptions = AttributeFilters & PageOptions;
export type RelationListOptions = RelationFilters & PageOptions;
export type ActionListOptions = ActionFilters & PageOptions;

/**
 * The fact collections, in the order the bounded reads present them.
 *
 * Every surface that returns a bounded head of facts — `entities.get`, the
 * `/inspect` entity ref, and each section of `client.lookup` — reports
 * `truncated` and points here for the rest. These listings page by cursor in
 * the same newest-first order, so a truncated head is a genuine prefix of the
 * walk rather than a separate ranking.
 */
export class Facts {
    private readonly transport: Transport;

    private readonly contextId: string;

    constructor(transport: Transport, contextId: string) {
        this.transport = transport;
        this.contextId = contextId;
    }

    private get base(): string {
        return getContextApiPrefix(this.contextId);
    }

    /**
     * Lists one page of live attributes, newest first (`GET /attributes`).
     *
     * Live means not superseded and inside its validity window. Superseded
     * values are reachable through the entity history endpoints.
     */
    async attributes(options?: AttributeListOptions): Promise<AttributeListResponseJson> {
        const query: Record<string, unknown> = {};
        if (options?.entity !== undefined) query.entity = options.entity;
        if (options?.key !== undefined) query.key = options.key;
        addPageParams(query, options);
        const body = await this.transport.requestJson("GET", `${this.base}/attributes`, { query });
        return body as AttributeListResponseJson;
    }

    /** Every matching attribute, following cursors to exhaustion. */
    async allAttributes(
        options?: AttributeFilters & { limit?: number; max?: number },
    ): Promise<AttributeDetailJson[]> {
        return collectPages(
            (cursor) => this.attributes({ ...options, cursor }),
            "attributes",
            options?.max,
        );
    }

    /**
     * Lists one page of live relation edges, newest first (`GET /relations`).
     *
     * `src` and `dst` filter one direction each. An entity's whole edge set is
     * the union of both walks — see {@link Facts.allEdgesOf}, which does that
     * for you.
     */
    async relations(options?: RelationListOptions): Promise<RelationListResponseJson> {
        const query: Record<string, unknown> = {};
        if (options?.src !== undefined) query.src = options.src;
        if (options?.dst !== undefined) query.dst = options.dst;
        if (options?.label !== undefined) query.label = options.label;
        addPageParams(query, options);
        const body = await this.transport.requestJson("GET", `${this.base}/relations`, { query });
        return body as RelationListResponseJson;
    }

    /** Every matching relation, following cursors to exhaustion. */
    async allRelations(
        options?: RelationFilters & { limit?: number; max?: number },
    ): Promise<RelationDetailJson[]> {
        return collectPages(
            (cursor) => this.relations({ ...options, cursor }),
            "relations",
            options?.max,
        );
    }

    /**
     * Every edge touching an entity, in both directions.
     *
     * This is what a truncated relation section points at. `src` and `dst` are
     * separate filters, so either walk alone reproduces half the set that
     * `entities.get` and `lookup` return; this runs both and concatenates them,
     * outbound first.
     *
     * @param entity The subject, as `<type>/<name>`.
     */
    async allEdgesOf(
        entity: string,
        options?: { label?: string; limit?: number },
    ): Promise<RelationDetailJson[]> {
        const [outbound, inbound] = await Promise.all([
            this.allRelations({ src: entity, label: options?.label, limit: options?.limit }),
            this.allRelations({ dst: entity, label: options?.label, limit: options?.limit }),
        ]);
        return [...outbound, ...inbound];
    }

    /**
     * Lists one page of live actions — dated events — newest first by write
     * time (`GET /actions`).
     *
     * Ordered on write time rather than event time because event time is
     * revisable, and a revision under an event-time ordering would move a row
     * across page boundaries mid-walk. `since` and `until` still bound the
     * event time.
     */
    async actions(options?: ActionListOptions): Promise<ActionListResponseJson> {
        const query: Record<string, unknown> = {};
        if (options?.actor !== undefined) query.actor = options.actor;
        if (options?.verb !== undefined) query.verb = options.verb;
        if (options?.since !== undefined) query.since = options.since;
        if (options?.until !== undefined) query.until = options.until;
        addPageParams(query, options);
        const body = await this.transport.requestJson("GET", `${this.base}/actions`, { query });
        return body as ActionListResponseJson;
    }

    /** Every matching action, following cursors to exhaustion. */
    async allActions(
        options?: ActionFilters & { limit?: number; max?: number },
    ): Promise<ActionDetailJson[]> {
        return collectPages(
            (cursor) => this.actions({ ...options, cursor }),
            "actions",
            options?.max,
        );
    }
}
