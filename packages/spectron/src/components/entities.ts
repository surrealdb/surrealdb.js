import { encodePathSegment, getContextApiPrefix } from "../paths.js";
import type { Transport } from "../transport.js";
import type { components } from "../types/generated.js";

type EntityDetailJson = components["schemas"]["EntityDetailJson"];
type EntityListResponseJson = components["schemas"]["EntityListResponseJson"];
type EntityResponseJson = components["schemas"]["EntityResponseJson"];
type EntityHistoryResponseJson = components["schemas"]["EntityHistoryResponseJson"];
type AttributeDetailJson = components["schemas"]["AttributeDetailJson"];

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

    /** Lists entities, optionally filtered by type. */
    async list(options?: { type?: string }): Promise<EntityDetailJson[]> {
        const body = await this.transport.requestJson("GET", this.base, {
            query: options?.type !== undefined ? { type: options.type } : undefined,
        });
        return (body as EntityListResponseJson).entities;
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
