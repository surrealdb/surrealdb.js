import { encodePathSegment, getContextApiPrefix } from "../paths.js";
import { type Scope, serialiseScope } from "../scope.js";
import type { Transport } from "../transport.js";
import type { TurnRole } from "../types/domain.js";
import type {
    ChatReplyWire,
    ContextResultWire,
    ExtractionResultWire,
    SessionInfoWire,
    TurnWire,
} from "../types/memory-wire.js";

/** Active conversation session within a Spectron context. */
export class Session {
    private readonly transport: Transport;

    private readonly contextId: string;

    readonly id: string;

    constructor(transport: Transport, contextId: string, info: SessionInfoWire) {
        this.transport = transport;
        this.contextId = contextId;
        this.id = info.id;
    }

    /** Deletes this session on the server. */
    async close(): Promise<void> {
        const base = `${getContextApiPrefix(this.contextId)}/sessions/${encodePathSegment(this.id)}`;
        await this.transport.requestJson("DELETE", base);
    }

    /** Appends a turn and returns structured extraction output. */
    async turn(options: {
        role: TurnRole | string;
        content: string;
    }): Promise<ExtractionResultWire> {
        const base = `${getContextApiPrefix(this.contextId)}/sessions/${encodePathSegment(this.id)}/turns`;
        const body = await this.transport.requestJson("POST", base, {
            body: { role: options.role, content: options.content },
        });
        return body as ExtractionResultWire;
    }

    /** Lists turns in this session. */
    async turns(): Promise<TurnWire[]> {
        const base = `${getContextApiPrefix(this.contextId)}/sessions/${encodePathSegment(this.id)}/turns`;
        const body = await this.transport.requestJson("GET", base);
        if (
            body &&
            typeof body === "object" &&
            "turns" in body &&
            Array.isArray((body as { turns: unknown }).turns)
        ) {
            return (body as { turns: TurnWire[] }).turns;
        }
        if (Array.isArray(body)) return body as TurnWire[];
        return [];
    }

    /** Retrieves formatted context for a query (caller-driven loop). */
    async context(options: { query: string; k?: number }): Promise<ContextResultWire> {
        const base = `${getContextApiPrefix(this.contextId)}/sessions/${encodePathSegment(this.id)}/context`;
        const payload: Record<string, unknown> = { query: options.query };
        if (options.k !== undefined) payload.k = options.k;
        const body = await this.transport.requestJson("POST", base, { body: payload });
        return body as ContextResultWire;
    }

    /** Full chat round trip: Spectron-driven loop (reply + memory updates). */
    async chat(options: { message: string }): Promise<ChatReplyWire> {
        const base = `${getContextApiPrefix(this.contextId)}/sessions/${encodePathSegment(this.id)}/chat`;
        const body = await this.transport.requestJson("POST", base, {
            body: { message: options.message },
        });
        return body as ChatReplyWire;
    }
}

/** Creates and manages sessions for a context. */
export class Sessions {
    private readonly transport: Transport;

    private readonly contextId: string;

    constructor(transport: Transport, contextId: string) {
        this.transport = transport;
        this.contextId = contextId;
    }

    /** Opens a new session with optional scope and metadata. */
    async create(options?: {
        scope?: Scope;
        metadata?: Record<string, unknown>;
    }): Promise<Session> {
        const base = `${getContextApiPrefix(this.contextId)}/sessions`;
        const payload: Record<string, unknown> = {};
        const scopeWire = serialiseScope(options?.scope);
        if (scopeWire) payload.scope = scopeWire;
        if (options?.metadata) payload.metadata = options.metadata;
        const body = await this.transport.requestJson("POST", base, { body: payload });
        if (!body || typeof body !== "object" || !("id" in body)) {
            throw new TypeError("Invalid session create response");
        }
        return new Session(this.transport, this.contextId, body as SessionInfoWire);
    }
}
