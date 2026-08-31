import { Documents } from "./components/documents.js";
import { Entities } from "./components/entities.js";
import { Keys } from "./components/keys.js";
import { Lifecycle } from "./components/lifecycle.js";
import { Principals } from "./components/principals.js";
import { Scopes } from "./components/scopes.js";
import { Sessions } from "./components/sessions.js";
import { Traces } from "./components/traces.js";
import { addPageParams, type CursorOptions, collectPages } from "./pagination.js";
import { getContextApiPrefix } from "./paths.js";
import { normaliseScope, type Scope } from "./scope.js";
import { type ChatChunk, parseChatStream } from "./streaming.js";
import { Transport } from "./transport.js";
import type {
    BatchExtractionMode,
    InferMode,
    MemoryCategory,
    ScopeView,
    TurnRole,
} from "./types/domain.js";
import type { components } from "./types/generated.js";

export type FactsResponseJson = components["schemas"]["FactsResponseJson"];
export type FactsBatchResponseJson = components["schemas"]["FactsBatchResponseJson"];
export type QueryMemoryResponseJson = components["schemas"]["QueryMemoryResponseJson"];
export type MemoryHitJson = components["schemas"]["MemoryHitJson"];
export type ChatResponseJson = components["schemas"]["ChatResponseJson"];
export type ForgetResponseJson = components["schemas"]["ForgetResponseJson"];
export type ContextQueryResponseJson = components["schemas"]["ContextQueryResponseJson"];
export type ReflectResponseJson = components["schemas"]["ReflectResponseJson"];
export type ConsolidateResponseJson = components["schemas"]["ConsolidateResponseJson"];
export type ElaborateResponseJson = components["schemas"]["ElaborateResponseJson"];
export type FsckReportJson = components["schemas"]["FsckReportJson"];
export type InspectResponseJson = components["schemas"]["InspectResponseJson"];
export type AuditResponseJson = components["schemas"]["AuditResponseJson"];
export type AuditRowJson = components["schemas"]["AuditRowJson"];
export type StateResponseJson = components["schemas"]["StateResponseJson"];
export type ProfileResponseJson = components["schemas"]["ProfileResponseJson"];

/**
 * The calling principal's identity and resolved authorisation for this context
 * (`GET /me`). Aliased to the generated OpenAPI `WhoamiJson` schema.
 */
export type WhoamiResponseJson = components["schemas"]["WhoamiJson"];
export type Triple = components["schemas"]["Triple"];
export type BatchMessage = components["schemas"]["BatchMessage"];
export type GeoFilterJson = components["schemas"]["GeoFilterJson"];

/** Options for constructing a {@link AgentMemory} client. */
export interface AgentMemoryOptions {
    /** Agent Memory context id (API path segment). */
    context: string;
    /** API key sent as an `Authorization: Bearer` token. */
    apiKey: string;
    /** API endpoint origin without trailing slash. */
    endpoint: string;
    /** Request timeout in milliseconds. Defaults to `30_000`. */
    timeout?: number;
    /** Maximum retry attempts for idempotent requests. Defaults to `3`. */
    maxRetries?: number;
    /** Override `fetch` (for tests or custom stacks). */
    fetchImpl?: typeof fetch;
}

/** Options for {@link AgentMemory.remember}. */
export interface RememberOptions {
    /** Inference mode. `full` is the default. */
    infer?: InferMode | string;
    /** Existing session to attach the turn to (auto-created when absent). */
    sessionId?: string;
    /** DNF scope selector the write targets (outer OR, inner AND). */
    scopes?: Scope;
    /** Role to record on the turn. `user` by default. */
    role?: TurnRole | string;
    /** Override the memory category for extracted/triple facts. */
    memoryCategory?: MemoryCategory | string;
    /** Descriptive `key=value` labels for the persisted rows. */
    labels?: string[];
    /** Caller-supplied triples (consumed when `infer = "triples"`). */
    triples?: Triple[];
}

/** Options for {@link AgentMemory.rememberMany}. */
export interface RememberManyOptions {
    /** Existing session to attach the turns to (auto-created when absent). */
    sessionId?: string;
    /** DNF scope selector the batch targets (outer OR, inner AND). */
    scopes?: Scope;
    /** Bulk extraction strategy. */
    extract?: BatchExtractionMode | string;
    /** Inference mode. */
    infer?: InferMode | string;
    /** Descriptive `key=value` labels for the persisted rows. */
    labels?: string[];
}

/** Options for {@link AgentMemory.recall}. */
export interface RecallOptions {
    /** Maximum number of hits to return. */
    k?: number;
    /** Retrieval mode. Defaults to `"hybrid"`. */
    mode?: string;
    /** Session to scope the recall to. */
    sessionId?: string;
    /** Result families to include (`facts`, `passages`). Defaults to both. */
    include?: string[];
    /** Historical query timestamp (known/valid time). */
    asOf?: string;
    /** System-time query instant (MVCC). */
    atInstant?: string;
    /** `key=value` label filter the result rows must all carry. */
    labels?: string[];
    /** Read lens: a DNF scope selector that narrows the read region (outer OR, inner AND). */
    lens?: Scope;
    /** Scope read breadth. Defaults to `strict`. */
    scopeView?: ScopeView | string;
    /** Valid-time lower bound. */
    validFrom?: string;
    /** Valid-time upper bound. */
    validUntil?: string;
    /** Free-form source label recorded on the trace. */
    source?: string;
    /** Geographic filter applied at read time. */
    location?: GeoFilterJson;
}

/** Options for {@link AgentMemory.chat}. */
export interface ChatOptions {
    /** Session to attach the conversation to. */
    sessionId?: string;
    /** DNF scope selector for the conversation (outer OR, inner AND). */
    scopes?: Scope;
    /** Model override. */
    model?: string;
    /** Skip the response cache and force a fresh call. */
    bypassCache?: boolean;
    /** Descriptive `key=value` labels for rows the chat persists. */
    labels?: string[];
}

/**
 * Filters and pagination for {@link AgentMemory.audit}.
 *
 * Extends {@link CursorOptions} rather than {@link PageOptions}: `/audit` takes
 * `limit` and `cursor` only, so there is no `count` to offer.
 */
export interface AuditOptions extends CursorOptions {
    /** Only rows attributed to this principal. */
    principal?: string;
    /** Only rows attributed to this API key. */
    key?: string;
    /** Only rows of this trace kind. */
    kind?: string;
    /** Lower bound on `createdAt`, as an RFC 3339 timestamp. */
    since?: string;
    /** Upper bound on `createdAt`, as an RFC 3339 timestamp. */
    until?: string;
}

function addDefined(target: Record<string, unknown>, key: string, value: unknown): void {
    if (value !== undefined) target[key] = value;
}

/**
 * Typed client for the public Agent Memory API: memory writes and recall, document
 * ingestion, sessions, entities, lifecycle, traces, and scope administration.
 *
 * The client is pinned to a single `context`; every call targets
 * `/api/v1/{context}/…`.
 */
export class AgentMemory {
    private readonly transport: Transport;

    /** Agent Memory context id this client calls. */
    readonly contextId: string;

    /** Document ingestion, retrieval, corpus search, and the keyword graph. */
    readonly documents: Documents;

    /** Entity records, attributes, relations, and attribute history. */
    readonly entities: Entities;

    /** Conversation sessions for this context. */
    readonly sessions: Sessions;

    /** Expiry and decay sweeps. */
    readonly lifecycle: Lifecycle;

    /** Retrieval trace tooling. */
    readonly traces: Traces;

    /** Principals and their scope grants. */
    readonly principals: Principals;

    /** The scope tree. */
    readonly scopes: Scopes;

    /** Self-service API keys for this context. */
    readonly keys: Keys;

    constructor(options: AgentMemoryOptions) {
        if (!options.context) {
            throw new TypeError("Agent Memory context is required.");
        }
        this.contextId = options.context;
        this.transport = new Transport({
            apiKey: options.apiKey,
            endpoint: options.endpoint,
            timeoutMs: options.timeout,
            maxRetries: options.maxRetries,
            fetchImpl: options.fetchImpl,
        });
        const components = AgentMemory.buildComponents(this.transport, this.contextId);
        this.documents = components.documents;
        this.entities = components.entities;
        this.sessions = components.sessions;
        this.lifecycle = components.lifecycle;
        this.traces = components.traces;
        this.principals = components.principals;
        this.scopes = components.scopes;
        this.keys = components.keys;
    }

    private static buildComponents(transport: Transport, contextId: string) {
        return {
            documents: new Documents(transport, contextId),
            entities: new Entities(transport, contextId),
            sessions: new Sessions(transport, contextId),
            lifecycle: new Lifecycle(transport, contextId),
            traces: new Traces(transport, contextId),
            principals: new Principals(transport, contextId),
            scopes: new Scopes(transport, contextId),
            keys: new Keys(transport, contextId),
        };
    }

    private get base(): string {
        return getContextApiPrefix(this.contextId);
    }

    /**
     * Returns a client that issues every request on behalf of `principalId`,
     * sending the `X-Agent-Memory-On-Behalf-Of` delegation header. Requires the
     * `manage` grant. The original client is left unchanged.
     */
    onBehalfOf(principalId: string): AgentMemory {
        if (!principalId) {
            throw new TypeError("onBehalfOf requires a principal id.");
        }
        const transport = this.transport.withOnBehalfOf(principalId);
        const delegate = Object.create(AgentMemory.prototype) as AgentMemory;
        return Object.assign(delegate, {
            contextId: this.contextId,
            transport,
            ...AgentMemory.buildComponents(transport, this.contextId),
        });
    }

    /**
     * Liveness probe for the API (`GET /api/v1/health`).
     * @throws {AgentMemoryError} When the service is unhealthy or unreachable.
     */
    async health(): Promise<void> {
        await this.transport.requestJson("GET", "/api/v1/health");
    }

    /**
     * Persists facts from free-form text and/or caller-supplied triples
     * (`POST /facts`). Idempotent within a 30-second window.
     */
    async remember(text?: string, options?: RememberOptions): Promise<FactsResponseJson> {
        const payload: Record<string, unknown> = {};
        addDefined(payload, "text", text);
        addDefined(payload, "infer", options?.infer);
        addDefined(payload, "session_id", options?.sessionId);
        addDefined(payload, "scopes", normaliseScope(options?.scopes));
        addDefined(payload, "role", options?.role);
        addDefined(payload, "memory_category", options?.memoryCategory);
        addDefined(payload, "labels", options?.labels);
        addDefined(payload, "triples", options?.triples);
        const body = await this.transport.requestJson("POST", `${this.base}/facts`, {
            body: payload,
            idempotent: true,
        });
        return body as FactsResponseJson;
    }

    /**
     * Persists facts from a batch of conversation messages (`POST /facts/batch`).
     * Idempotent within a 30-second window.
     */
    async rememberMany(
        messages: BatchMessage[],
        options?: RememberManyOptions,
    ): Promise<FactsBatchResponseJson> {
        const payload: Record<string, unknown> = { messages };
        addDefined(payload, "session_id", options?.sessionId);
        addDefined(payload, "scopes", normaliseScope(options?.scopes));
        addDefined(payload, "extract", options?.extract);
        addDefined(payload, "infer", options?.infer);
        addDefined(payload, "labels", options?.labels);
        const body = await this.transport.requestJson("POST", `${this.base}/facts/batch`, {
            body: payload,
            idempotent: true,
        });
        return body as FactsBatchResponseJson;
    }

    /** Semantic recall over memory for this context (`POST /query`). */
    async recall(query: string, options?: RecallOptions): Promise<QueryMemoryResponseJson> {
        const payload: Record<string, unknown> = { query };
        addDefined(payload, "k", options?.k);
        addDefined(payload, "mode", options?.mode);
        addDefined(payload, "sessionId", options?.sessionId);
        addDefined(payload, "include", options?.include);
        addDefined(payload, "asOf", options?.asOf);
        addDefined(payload, "atInstant", options?.atInstant);
        addDefined(payload, "labels", options?.labels);
        addDefined(payload, "lens", normaliseScope(options?.lens));
        addDefined(payload, "scopeView", options?.scopeView);
        addDefined(payload, "validFrom", options?.validFrom);
        addDefined(payload, "validUntil", options?.validUntil);
        addDefined(payload, "source", options?.source);
        addDefined(payload, "location", options?.location);
        const body = await this.transport.requestJson("POST", `${this.base}/query`, {
            body: payload,
        });
        return body as QueryMemoryResponseJson;
    }

    /** Forgets memory matching a natural-language query (`POST /forget`). */
    async forget(query: string, options?: { purge?: boolean }): Promise<ForgetResponseJson> {
        const payload: Record<string, unknown> = { query };
        if (options?.purge) payload.purge = true;
        const body = await this.transport.requestJson("POST", `${this.base}/forget`, {
            body: payload,
        });
        return body as ForgetResponseJson;
    }

    /**
     * Full chat round trip (`POST /chat`). Returns the reply plus memory updates,
     * or — when `stream` is `true` — an async stream of {@link ChatChunk}s.
     */
    async chat(
        message: string,
        options?: ChatOptions & { stream?: false },
    ): Promise<ChatResponseJson>;
    async chat(
        message: string,
        options: ChatOptions & { stream: true },
    ): Promise<AsyncGenerator<ChatChunk>>;
    async chat(
        message: string,
        options?: ChatOptions & { stream?: boolean },
    ): Promise<ChatResponseJson | AsyncGenerator<ChatChunk>> {
        const payload: Record<string, unknown> = { message };
        addDefined(payload, "sessionId", options?.sessionId);
        addDefined(payload, "scopes", normaliseScope(options?.scopes));
        addDefined(payload, "model", options?.model);
        if (options?.bypassCache) payload.bypassCache = true;
        addDefined(payload, "labels", options?.labels);

        if (options?.stream) {
            payload.stream = true;
            const response = await this.transport.stream("POST", `${this.base}/chat`, {
                body: payload,
            });
            return parseChatStream(response);
        }
        const body = await this.transport.requestJson("POST", `${this.base}/chat`, {
            body: payload,
        });
        return body as ChatResponseJson;
    }

    /** Retrieves LLM-facing context text for a query without a session (`POST /context`). */
    async context(
        query: string,
        options?: {
            k?: number;
            labels?: string[];
            lens?: Scope;
            scopeView?: ScopeView | string;
        },
    ): Promise<ContextQueryResponseJson> {
        const payload: Record<string, unknown> = { query };
        addDefined(payload, "k", options?.k);
        addDefined(payload, "labels", options?.labels);
        addDefined(payload, "lens", normaliseScope(options?.lens));
        addDefined(payload, "scopeView", options?.scopeView);
        const body = await this.transport.requestJson("POST", `${this.base}/context`, {
            body: payload,
        });
        return body as ContextQueryResponseJson;
    }

    /** Runs a reflection pass; may persist attributes when `persist` is true (`POST /reflect`). */
    async reflect(query: string, options?: { persist?: boolean }): Promise<ReflectResponseJson> {
        const body = await this.transport.requestJson("POST", `${this.base}/reflect`, {
            body: { query, persist: options?.persist ?? false },
        });
        return body as ReflectResponseJson;
    }

    /** Consolidates accumulated observations into durable facts (`POST /consolidate`). */
    async consolidate(options?: {
        dryRun?: boolean;
        factLimit?: number;
        observationLimit?: number;
    }): Promise<ConsolidateResponseJson> {
        const payload: Record<string, unknown> = {};
        if (options?.dryRun) payload.dryRun = true;
        addDefined(payload, "factLimit", options?.factLimit);
        addDefined(payload, "observationLimit", options?.observationLimit);
        const body = await this.transport.requestJson("POST", `${this.base}/consolidate`, {
            body: payload,
        });
        return body as ConsolidateResponseJson;
    }

    /** Infers and emits new relation edges between entities (`POST /elaborate`). */
    async elaborate(options?: {
        entityRef?: string;
        budget?: number;
        sweep?: boolean;
        dryRun?: boolean;
    }): Promise<ElaborateResponseJson> {
        const payload: Record<string, unknown> = {};
        addDefined(payload, "entityRef", options?.entityRef);
        addDefined(payload, "budget", options?.budget);
        if (options?.sweep) payload.sweep = true;
        if (options?.dryRun) payload.dryRun = true;
        const body = await this.transport.requestJson("POST", `${this.base}/elaborate`, {
            body: payload,
        });
        return body as ElaborateResponseJson;
    }

    /** Runs an integrity check over the memory store (`POST /fsck`). */
    async fsck(options?: {
        check?: string;
        duplicateThreshold?: number;
        maxResults?: number;
    }): Promise<FsckReportJson> {
        const payload: Record<string, unknown> = {};
        addDefined(payload, "check", options?.check);
        addDefined(payload, "duplicateThreshold", options?.duplicateThreshold);
        addDefined(payload, "maxResults", options?.maxResults);
        const body = await this.transport.requestJson("POST", `${this.base}/fsck`, {
            body: payload,
        });
        return body as FsckReportJson;
    }

    /** Inspects an entity, attribute, or trace by reference (`GET /inspect`). */
    async inspect(
        ref: string,
        options?: { asOf?: string; atInstant?: string; validFrom?: string; validUntil?: string },
    ): Promise<InspectResponseJson> {
        const query: Record<string, unknown> = { ref };
        addDefined(query, "asOf", options?.asOf);
        addDefined(query, "atInstant", options?.atInstant);
        addDefined(query, "validFrom", options?.validFrom);
        addDefined(query, "validUntil", options?.validUntil);
        const body = await this.transport.requestJson("GET", `${this.base}/inspect`, { query });
        return body as InspectResponseJson;
    }

    /** Lists one page of audit rows for write/recall activity (`GET /audit`). */
    async audit(options?: AuditOptions): Promise<AuditResponseJson> {
        const query: Record<string, unknown> = {};
        addDefined(query, "principal", options?.principal);
        addDefined(query, "key", options?.key);
        addDefined(query, "kind", options?.kind);
        addDefined(query, "since", options?.since);
        addDefined(query, "until", options?.until);
        addPageParams(query, options);
        const body = await this.transport.requestJson("GET", `${this.base}/audit`, { query });
        return body as AuditResponseJson;
    }

    /** Every matching audit row, following cursors to exhaustion. */
    async auditAll(options?: Omit<AuditOptions, "cursor">): Promise<AuditRowJson[]> {
        return collectPages((cursor) => this.audit({ ...options, cursor }), "rows");
    }

    /**
     * Structured memory state snapshot (`GET /state`).
     *
     * A snapshot, not an export: this is a composite read over six tables, each
     * bounded by `limit` (default 100, max 500), and `truncated` reports which
     * of them had more rows.
     *
     * Four of those tables have their own collection endpoint to enumerate them
     * completely — entities (see {@link AgentMemory.entities}), attributes,
     * relations, and actions. The remaining two, `instructions` and `unknowns`,
     * have no such route: when `truncated` flags either, the omitted rows cannot
     * be recovered other than by raising `limit`.
     */
    async state(options?: { limit?: number }): Promise<StateResponseJson> {
        const query: Record<string, unknown> = {};
        addDefined(query, "limit", options?.limit);
        const body = await this.transport.requestJson("GET", `${this.base}/state`, { query });
        return body as StateResponseJson;
    }

    /** Static and dynamic profile slices (`GET /profile`). */
    async profile(): Promise<ProfileResponseJson> {
        const body = await this.transport.requestJson("GET", `${this.base}/profile`);
        return body as ProfileResponseJson;
    }

    /** The calling principal's identity and resolved grants (`GET /me`). */
    async whoami(): Promise<WhoamiResponseJson> {
        const body = await this.transport.requestJson("GET", `${this.base}/me`);
        return body as WhoamiResponseJson;
    }
}
