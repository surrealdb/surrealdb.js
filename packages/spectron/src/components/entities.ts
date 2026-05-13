import { encodePathSegment, getContextApiPrefix } from "../paths.js";
import type { Transport } from "../transport.js";
import type { EntityHistoryEntryWire, EntityWire } from "../types/memory-wire.js";

/** Entity CRUD and history for Layer 1 memory. */
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
    async list(options?: { type?: string }): Promise<EntityWire[]> {
        const body = await this.transport.requestJson("GET", this.base, {
            query: options?.type !== undefined ? { type: options.type } : undefined,
        });
        if (
            body &&
            typeof body === "object" &&
            "entities" in body &&
            Array.isArray((body as { entities: unknown }).entities)
        ) {
            return (body as { entities: EntityWire[] }).entities;
        }
        if (Array.isArray(body)) return body as EntityWire[];
        return [];
    }

    /** Fetches a single entity by type and name. */
    async get(entityType: string, name: string): Promise<EntityWire> {
        const path = `${this.base}/${encodePathSegment(entityType)}/${encodePathSegment(name)}`;
        const body = await this.transport.requestJson("GET", path);
        return body as EntityWire;
    }

    /** Returns history for one attribute key. */
    async history(
        entityType: string,
        name: string,
        key: string,
    ): Promise<EntityHistoryEntryWire[]> {
        const path = `${this.base}/${encodePathSegment(entityType)}/${encodePathSegment(name)}/history/${encodePathSegment(key)}`;
        const body = await this.transport.requestJson("GET", path);
        if (
            body &&
            typeof body === "object" &&
            "history" in body &&
            Array.isArray((body as { history: unknown }).history)
        ) {
            return (body as { history: EntityHistoryEntryWire[] }).history;
        }
        if (Array.isArray(body)) return body as EntityHistoryEntryWire[];
        return [];
    }

    /** Soft-deletes an entity (sets valid-until). */
    async delete(entityType: string, name: string): Promise<void> {
        const path = `${this.base}/${encodePathSegment(entityType)}/${encodePathSegment(name)}`;
        await this.transport.requestJson("DELETE", path);
    }
}
