import { getContextApiPrefix } from "../paths.js";
import type { Transport } from "../transport.js";
import type { components } from "../types/generated.js";

type ScopeNodeJson = components["schemas"]["ScopeNodeJson"];
type ForgetScopeResponseJson = components["schemas"]["ForgetScopeResponseJson"];

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

    /** Lists registered scope nodes. */
    async list(): Promise<ScopeNodeJson[]> {
        const body = await this.transport.requestJson("GET", this.base);
        return body as ScopeNodeJson[];
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
