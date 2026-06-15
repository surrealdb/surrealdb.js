import { encodePathSegment, getContextApiPrefix } from "../paths.js";
import type { Transport } from "../transport.js";

/**
 * A freshly minted (or rotated) self-service key. `key` is the full bearer
 * secret (`sp-{id}-{secret}`) and is only ever returned once.
 */
export interface MintedKeyJson {
    id: string;
    key: string;
    validUntil?: string | null;
}

/** Metadata for an existing self-service key. The secret is never returned. */
export interface KeyDetailJson {
    id: string;
    name?: string;
    createdAt?: string;
    grants?: Record<string, unknown> | null;
    lastUsedAt?: string | null;
    validUntil?: string | null;
}

/** Self-service API keys for this context (requires the `manage` grant). */
export class Keys {
    private readonly transport: Transport;

    private readonly contextId: string;

    constructor(transport: Transport, contextId: string) {
        this.transport = transport;
        this.contextId = contextId;
    }

    private get base(): string {
        return `${getContextApiPrefix(this.contextId)}/keys`;
    }

    /**
     * Mints a new key. The full secret is returned once in
     * {@link MintedKeyJson.key} and cannot be retrieved again.
     */
    async create(options?: {
        name?: string;
        grants?: Record<string, unknown>;
        ttlSeconds?: number;
    }): Promise<MintedKeyJson> {
        const payload: Record<string, unknown> = {};
        if (options?.name !== undefined) payload.name = options.name;
        if (options?.grants !== undefined) payload.grants = options.grants;
        const body = await this.transport.requestJson("POST", this.base, {
            body: Object.keys(payload).length > 0 ? payload : undefined,
            query: { ttlSeconds: options?.ttlSeconds },
        });
        return body as MintedKeyJson;
    }

    /** Lists key metadata for the context (secrets are never included). */
    async list(): Promise<KeyDetailJson[]> {
        const body = await this.transport.requestJson("GET", this.base);
        return (body as KeyDetailJson[] | null) ?? [];
    }

    /** Revokes a key by name. */
    async delete(keyName: string): Promise<void> {
        await this.transport.requestJson("DELETE", `${this.base}/${encodePathSegment(keyName)}`);
    }

    /** Rotates a key, returning a fresh secret in {@link MintedKeyJson.key}. */
    async rotate(keyName: string, options?: { ttlSeconds?: number }): Promise<MintedKeyJson> {
        const body = await this.transport.requestJson(
            "POST",
            `${this.base}/${encodePathSegment(keyName)}/rotate`,
            { query: { ttlSeconds: options?.ttlSeconds } },
        );
        return body as MintedKeyJson;
    }
}
