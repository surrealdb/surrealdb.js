import { addPageParams, collectPages, type PageOptions } from "../pagination.js";
import { getContextApiPrefix } from "../paths.js";
import type { Transport } from "../transport.js";
import type { components } from "../types/generated.js";

export type ScopeNodeJson = components["schemas"]["ScopeNodeJson"];
export type ScopeListResponseJson = components["schemas"]["ScopeListResponseJson"];
export type ForgetScopeResponseJson = components["schemas"]["ForgetScopeResponseJson"];

/** The scope tree: register, list, delete, and forget scope subtrees. */
export class Scopes {
    private readonly transport: Transport;

    private readonly contextId: string;

    constructor(transport: Transport, contextId: string) {
        this.transport = transport;
        this.contextId = contextId;
    }

    private get base(): string {
        return `${getContextApiPrefix(this.contextId)}/scopes`;
    }

    /**
     * Lists one page of registered scope nodes.
     *
     * `scopes` can hold fewer than `limit` entries while `page.hasMore` is still
     * true: the server bounds the page in the database and then drops nodes the
     * caller has no grant over, so invisible nodes consume page budget without
     * appearing. Terminate a walk on `page.nextCursor`, never on a short page —
     * or call {@link listAll}, which does it correctly.
     */
    async list(options?: PageOptions): Promise<ScopeListResponseJson> {
        const query: Record<string, unknown> = {};
        addPageParams(query, options);
        const body = await this.transport.requestJson("GET", this.base, { query });
        return body as ScopeListResponseJson;
    }

    /**
     * Every registered scope node, following cursors to exhaustion.
     *
     * The scope tree is consumed whole — as a tree to render, or as the source
     * for scope autocomplete and validation — so a single page of it is not
     * useful.
     */
    async listAll(options?: { limit?: number }): Promise<ScopeNodeJson[]> {
        return collectPages((cursor) => this.list({ limit: options?.limit, cursor }), "scopes");
    }

    /** Registers a scope path with optional display metadata. */
    async register(options: {
        path: string;
        displayName?: string;
        description?: string;
    }): Promise<ScopeNodeJson> {
        const payload: Record<string, unknown> = { path: options.path };
        if (options.displayName !== undefined) payload.displayName = options.displayName;
        if (options.description !== undefined) payload.description = options.description;
        const body = await this.transport.requestJson("POST", this.base, { body: payload });
        return body as ScopeNodeJson;
    }

    /** Deletes (tombstones) a scope node by path. */
    async delete(path: string): Promise<void> {
        await this.transport.requestJson("DELETE", this.base, { query: { path } });
    }

    /** Forgets (erases) a scope subtree. Returns the number of rows forgotten. */
    async forget(options?: { path?: string }): Promise<ForgetScopeResponseJson> {
        const payload: Record<string, unknown> = {};
        if (options?.path !== undefined) payload.path = options.path;
        const body = await this.transport.requestJson("POST", `${this.base}/forget`, {
            body: payload,
        });
        return body as ForgetScopeResponseJson;
    }
}
