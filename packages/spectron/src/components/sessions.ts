import { encodePathSegment, getContextApiPrefix } from "../paths.js";
import { normaliseScope, type Scope } from "../scope.js";
import type { Transport } from "../transport.js";
import type { components } from "../types/generated.js";

type SessionResponseJson = components["schemas"]["SessionResponseJson"];
type SessionContextResponseJson = components["schemas"]["SessionContextResponseJson"];
type TurnListResponseJson = components["schemas"]["TurnListResponseJson"];
type TurnResponseJson = components["schemas"]["TurnResponseJson"];

/** An open conversation session within a Spectron context. */
export class Session {
    private readonly transport: Transport;

    private readonly contextId: string;

    /** Session id (API path segment). */
    readonly id: string;

    /** Creation timestamp. */
    readonly createdAt: string;

    /** DNF scope selector the session writes to (outer OR, inner AND). */
    readonly scopes: string[][];

    constructor(transport: Transport, contextId: string, info: SessionResponseJson) {
        this.transport = transport;
        this.contextId = contextId;
        this.id = info.id;
        this.createdAt = info.createdAt;
        this.scopes = info.scopes;
    }

    private get base(): string {
        return `${getContextApiPrefix(this.contextId)}/sessions/${encodePathSegment(this.id)}`;
    }

    /** Deletes this session on the server. */
    async close(): Promise<void> {
        await this.transport.requestJson("DELETE", this.base);
    }

    /** Lists turns recorded against this session. */
    async turns(): Promise<TurnResponseJson[]> {
        const body = await this.transport.requestJson("GET", `${this.base}/turns`);
        return (body as TurnListResponseJson).turns;
    }

    /** Retrieves session-scoped LLM context text for a query. */
    async context(options: { query: string }): Promise<SessionContextResponseJson> {
        const body = await this.transport.requestJson("POST", `${this.base}/context`, {
            body: { query: options.query },
        });
        return body as SessionContextResponseJson;
    }
}

/** Creates and manages conversation sessions for a context. */
export class Sessions {
    private readonly transport: Transport;

    private readonly contextId: string;

    constructor(transport: Transport, contextId: string) {
        this.transport = transport;
        this.contextId = contextId;
    }

    /** Opens a new session with an optional DNF scope selector and metadata. */
    async create(options?: { scopes?: Scope; metadata?: unknown }): Promise<Session> {
        const base = `${getContextApiPrefix(this.contextId)}/sessions`;
        const payload: Record<string, unknown> = {};
        const scopes = normaliseScope(options?.scopes);
        if (scopes) payload.scopes = scopes;
        if (options?.metadata !== undefined) payload.metadata = options.metadata;
        const body = await this.transport.requestJson("POST", base, { body: payload });
        return new Session(this.transport, this.contextId, body as SessionResponseJson);
    }
}
