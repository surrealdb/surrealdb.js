import { addPageParams, collectPages, type PageOptions } from "../pagination.js";
import { encodePathSegment, getContextApiPrefix } from "../paths.js";
import type { Transport } from "../transport.js";
import type { components } from "../types/generated.js";

export type EntityDetailJson = components["schemas"]["EntityDetailJson"];
export type EntityListResponseJson = components["schemas"]["EntityListResponseJson"];
export type EntityResponseJson = components["schemas"]["EntityResponseJson"];
export type EntityHistoryResponseJson = components["schemas"]["EntityHistoryResponseJson"];
export type AttributeDetailJson = components["schemas"]["AttributeDetailJson"];

/** Entity records, attributes, relations, and attribute history. */
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

    /** Fetches a single entity by type and name, with its attributes and relations. */
    async get(entityType: string, name: string): Promise<EntityResponseJson> {
        const path = `${this.base}/${encodePathSegment(entityType)}/${encodePathSegment(name)}`;
        const body = await this.transport.requestJson("GET", path);
        return body as EntityResponseJson;
    }

    /** Returns the supersession history for one attribute key. */
    async history(entityType: string, name: string, key: string): Promise<AttributeDetailJson[]> {
        const path = `${this.base}/${encodePathSegment(entityType)}/${encodePathSegment(name)}/history/${encodePathSegment(key)}`;
        const body = await this.transport.requestJson("GET", path);
        return (body as EntityHistoryResponseJson).history;
    }

    /** Soft-deletes an entity (sets valid-until). */
    async delete(entityType: string, name: string): Promise<void> {
        const path = `${this.base}/${encodePathSegment(entityType)}/${encodePathSegment(name)}`;
        await this.transport.requestJson("DELETE", path);
    }
}
