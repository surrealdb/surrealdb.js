import { Entities } from "./components/entities.js";
import { Knowledge } from "./components/knowledge.js";
import { Lifecycle } from "./components/lifecycle.js";
import { Sessions } from "./components/sessions.js";
import { Traces } from "./components/traces.js";
import { getContextApiPrefix } from "./paths.js";
import { Transport } from "./transport.js";
import type {
    ContextResultWire,
    ForgetResultWire,
    MemoryQueryResponseWire,
    ProfileResponseWire,
    ReflectionResultWire,
    StructuredStateWire,
} from "./types/memory-wire.js";

/** Options for constructing a {@link Spectron} client. */
export interface SpectronOptions {
    /** Spectron context id (API path segment). */
    context: string;
    /** Bearer API key. */
    apiKey: string;
    /** API origin without trailing slash. Defaults to `https://api.spectron.dev`. */
    baseUrl?: string;
    /** Request timeout in milliseconds. Defaults to `30_000`. */
    timeout?: number;
    /** Maximum retry attempts for idempotent `GET` requests. Defaults to `3`. */
    maxRetries?: number;
    /** Override `fetch` (for tests or custom stacks). */
    fetchImpl?: typeof fetch;
}

/**
 * Typed client for the public Spectron API: Layer 0 knowledge, sessions, entities,
 * lifecycle, traces, and one-shot memory operations.
 */
export class Spectron {
    private readonly transport: Transport;

    /** Spectron context id this client calls. */
    readonly contextId: string;

    /** Conversation sessions for this context. */
    readonly sessions: Sessions;

    /** Layer 1 entity records. */
    readonly entities: Entities;

    /** Expiry and decay sweeps. */
    readonly lifecycle: Lifecycle;

    /** Retrieval trace tooling. */
    readonly traces: Traces;

    /** Knowledge documents, keywords, nodes, and graph traversal. */
    readonly knowledge: Knowledge;

    constructor(options: SpectronOptions) {
        if (!options.context) {
            throw new TypeError("Spectron context is required.");
        }
        this.contextId = options.context;
        this.transport = new Transport({
            apiKey: options.apiKey,
            baseUrl: options.baseUrl,
            timeoutMs: options.timeout,
            maxRetries: options.maxRetries,
            fetchImpl: options.fetchImpl,
        });
        this.sessions = new Sessions(this.transport, this.contextId);
        this.entities = new Entities(this.transport, this.contextId);
        this.lifecycle = new Lifecycle(this.transport, this.contextId);
        this.traces = new Traces(this.transport, this.contextId);
        this.knowledge = new Knowledge(this.transport, this.contextId);
    }

    /**
     * Liveness probe for the API (`GET /api/v1/health`).
     * @throws {SpectronError} When the service is unhealthy or unreachable.
     */
    async health(): Promise<void> {
        await this.transport.requestJson("GET", "/api/v1/health");
    }

    /**
     * One-shot semantic retrieval over memory for this context.
     */
    async query(options: {
        query: string;
        k?: number;
        sessionId?: string;
    }): Promise<MemoryQueryResponseWire> {
        const payload: Record<string, unknown> = { query: options.query };
        if (options.k !== undefined) payload.k = options.k;
        if (options.sessionId !== undefined) payload.sessionId = options.sessionId;
        const base = getContextApiPrefix(this.contextId);
        const body = await this.transport.requestJson("POST", `${base}/query`, { body: payload });
        return body as MemoryQueryResponseWire;
    }

    /**
     * Retrieves LLM-facing context text for a query without a session.
     */
    async context(options: { query: string; k?: number }): Promise<ContextResultWire> {
        const payload: Record<string, unknown> = { query: options.query };
        if (options.k !== undefined) payload.k = options.k;
        const base = getContextApiPrefix(this.contextId);
        const body = await this.transport.requestJson("POST", `${base}/context`, { body: payload });
        return body as ContextResultWire;
    }

    /** Structured memory state snapshot. */
    async state(): Promise<StructuredStateWire> {
        const base = getContextApiPrefix(this.contextId);
        const body = await this.transport.requestJson("GET", `${base}/state`);
        return body as StructuredStateWire;
    }

    /** Static and dynamic profile slices. */
    async profile(): Promise<ProfileResponseWire> {
        const base = getContextApiPrefix(this.contextId);
        const body = await this.transport.requestJson("GET", `${base}/profile`);
        return body as ProfileResponseWire;
    }

    /** Runs a reflection pass; may persist attributes when `persist` is true. */
    async reflect(options: { query: string; persist?: boolean }): Promise<ReflectionResultWire> {
        const base = getContextApiPrefix(this.contextId);
        const body = await this.transport.requestJson("POST", `${base}/reflect`, {
            body: { query: options.query, persist: options.persist ?? false },
        });
        return body as ReflectionResultWire;
    }

    /** Forgets memory matching a natural-language query. */
    async forget(options: { query: string }): Promise<ForgetResultWire> {
        const base = getContextApiPrefix(this.contextId);
        const body = await this.transport.requestJson("POST", `${base}/forget`, {
            body: { query: options.query },
        });
        if (typeof body === "number") {
            return { deleted: body };
        }
        return body as ForgetResultWire;
    }
}
