import { Documents } from "./components/documents.js";
import { Entities } from "./components/entities.js";
import { Lifecycle } from "./components/lifecycle.js";
import { Principals } from "./components/principals.js";
import { Scopes } from "./components/scopes.js";
import { Sessions } from "./components/sessions.js";
import { Traces } from "./components/traces.js";
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

type FactsResponseJson = components["schemas"]["FactsResponseJson"];
type FactsBatchResponseJson = components["schemas"]["FactsBatchResponseJson"];
type QueryMemoryResponseJson = components["schemas"]["QueryMemoryResponseJson"];
type ChatResponseJson = components["schemas"]["ChatResponseJson"];
type ForgetResponseJson = components["schemas"]["ForgetResponseJson"];
type ContextQueryResponseJson = components["schemas"]["ContextQueryResponseJson"];
type ReflectResponseJson = components["schemas"]["ReflectResponseJson"];
type ConsolidateResponseJson = components["schemas"]["ConsolidateResponseJson"];
type ElaborateResponseJson = components["schemas"]["ElaborateResponseJson"];
type FsckReportJson = components["schemas"]["FsckReportJson"];
type InspectResponseJson = components["schemas"]["InspectResponseJson"];
type AuditResponseJson = components["schemas"]["AuditResponseJson"];
type StateResponseJson = components["schemas"]["StateResponseJson"];
type ProfileResponseJson = components["schemas"]["ProfileResponseJson"];
type Triple = components["schemas"]["Triple"];
type BatchMessage = components["schemas"]["BatchMessage"];
type GeoFilterJson = components["schemas"]["GeoFilterJson"];

/** Options for constructing a {@link Spectron} client. */
export interface SpectronOptions {
    /** Spectron context id (API path segment). */
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

/** Options for {@link Spectron.remember}. */
export interface RememberOptions {
    /** Inference mode. `full` is the default. */
    infer?: InferMode | string;
    /** Existing session to attach the turn to (auto-created when absent). */
    sessionId?: string;
    /** Scope paths the write targets. */
    scope?: Scope;
    /** Role to record on the turn. `user` by default. */
    role?: TurnRole | string;
    /** Override the memory category for extracted/triple facts. */
    memoryCategory?: MemoryCategory | string;
    /** Descriptive `key=value` labels for the persisted rows. */
    labels?: string[];
    /** Caller-supplied triples (consumed when `infer = "triples"`). */
    triples?: Triple[];
}

/** Options for {@link Spectron.rememberMany}. */
export interface RememberManyOptions {
    /** Existing session to attach the turns to (auto-created when absent). */
    sessionId?: string;
    /** Scope paths the batch targets. */
    scope?: Scope;
    /** Bulk extraction strategy. */
    extract?: BatchExtractionMode | string;
    /** Inference mode. */
    infer?: InferMode | string;
    /** Descriptive `key=value` labels for the persisted rows. */
    labels?: string[];
}

/** Options for {@link Spectron.recall}. */
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
    /** Read lens: scope paths / subtree patterns that narrow the read region. */
    lens?: string[];
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

/** Options for {@link Spectron.chat}. */
export interface ChatOptions {
    /** Session to attach the conversation to. */
    sessionId?: string;
    /** Scope paths for the conversation. */
    scope?: Scope;
    /** Model override. */
    model?: string;
    /** Skip the response cache and force a fresh call. */
    bypassCache?: boolean;
    /** Descriptive `key=value` labels for rows the chat persists. */
    labels?: string[];
}

function addDefined(target: Record<string, unknown>, key: string, value: unknown): void {
    if (value !== undefined) target[key] = value;
}

/**
 * Typed client for the public Spectron API: memory writes and recall, document
 * ingestion, sessions, entities, lifecycle, traces, and scope administration.
 *
 * The client is pinned to a single `context`; every call targets
 * `/api/v1/{context}/…`.
 */
export class Spectron {
    private readonly transport: Transport;

    /** Spectron context id this client calls. */
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

    constructor(options: SpectronOptions) {
        if (!options.context) {
            throw new TypeError("Spectron context is required.");
        }
        this.contextId = options.context;
        this.transport = new Transport({
            apiKey: options.apiKey,
            endpoint: options.endpoint,
            timeoutMs: options.timeout,
            maxRetries: options.maxRetries,
            fetchImpl: options.fetchImpl,
        });
        this.documents = new Documents(this.transport, this.contextId);
        this.entities = new Entities(this.transport, this.contextId);
        this.sessions = new Sessions(this.transport, this.contextId);
        this.lifecycle = new Lifecycle(this.transport, this.contextId);
        this.traces = new Traces(this.transport, this.contextId);
        this.principals = new Principals(this.transport, this.contextId);
        this.scopes = new Scopes(this.transport, this.contextId);
    }

    private get base(): string {
        return getContextApiPrefix(this.contextId);
    }

    /**
     * Liveness probe for the API (`GET /api/v1/health`).
     * @throws {SpectronError} When the service is unhealthy or unreachable.
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
        addDefined(payload, "scope", normaliseScope(options?.scope));
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
        addDefined(payload, "scope", normaliseScope(options?.scope));
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
        addDefined(payload, "lens", options?.lens);
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
        addDefined(payload, "scope", normaliseScope(options?.scope));
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
            lens?: string[];
            scopeView?: ScopeView | string;
        },
    ): Promise<ContextQueryResponseJson> {
        const payload: Record<string, unknown> = { query };
        addDefined(payload, "k", options?.k);
        addDefined(payload, "labels", options?.labels);
        addDefined(payload, "lens", options?.lens);
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

    /** Lists audit rows for write/recall activity (`GET /audit`). */
    async audit(options?: {
        principal?: string;
        key?: string;
        kind?: string;
        since?: string;
        until?: string;
        limit?: number;
    }): Promise<AuditResponseJson> {
        const query: Record<string, unknown> = {};
        addDefined(query, "principal", options?.principal);
        addDefined(query, "key", options?.key);
        addDefined(query, "kind", options?.kind);
        addDefined(query, "since", options?.since);
        addDefined(query, "until", options?.until);
        addDefined(query, "limit", options?.limit);
        const body = await this.transport.requestJson("GET", `${this.base}/audit`, { query });
        return body as AuditResponseJson;
    }

    /** Structured memory state snapshot (`GET /state`). */
    async state(): Promise<StateResponseJson> {
        const body = await this.transport.requestJson("GET", `${this.base}/state`);
        return body as StateResponseJson;
    }

    /** Static and dynamic profile slices (`GET /profile`). */
    async profile(): Promise<ProfileResponseJson> {
        const body = await this.transport.requestJson("GET", `${this.base}/profile`);
        return body as ProfileResponseJson;
    }
}
