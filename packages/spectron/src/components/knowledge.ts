import { spectronFileInputToBlob } from "../file-body.js";
import { encodePathSegment, getContextApiPrefix } from "../paths.js";
import { type Scope, serialiseScope } from "../scope.js";
import type { Transport } from "../transport.js";
import type { IngestProfile, QueryMode, SpectronFileInput } from "../types/domain.js";
import type { components } from "../types/generated.js";

type DocumentJson = components["schemas"]["DocumentJson"];
type DocumentPageJson = components["schemas"]["DocumentPageJson"];
type ChunkPageJson = components["schemas"]["ChunkPageJson"];
type UploadResponse = components["schemas"]["UploadResponse"];
type QueryRequestJson = components["schemas"]["QueryRequestJson"];
type QueryResponseJson = components["schemas"]["QueryResponseJson"];
type KeywordPageJson = components["schemas"]["KeywordPageJson"];
type KeywordSearchResponseJson = components["schemas"]["KeywordSearchResponseJson"];
type KeywordDetailJson = components["schemas"]["KeywordDetailJson"];
type KnowledgeNodePageJson = components["schemas"]["KnowledgeNodePageJson"];
type KnowledgeNodeFullJson = components["schemas"]["KnowledgeNodeFullJson"];
type KnowledgeNodeSearchResponseJson = components["schemas"]["KnowledgeNodeSearchResponseJson"];
type TraverseApiRequest = components["schemas"]["TraverseApiRequest"];
type TraverseApiResponse = components["schemas"]["TraverseApiResponse"];
type DocumentKeywordsResponse = components["schemas"]["DocumentKeywordsResponse"];
type KnowledgeNodeUpsertRow = components["schemas"]["KnowledgeNodeUpsertRow"];
type KnowledgeLinkUpsert = components["schemas"]["KnowledgeLinkUpsert"];
type KeywordSearchRequestJson = components["schemas"]["KeywordSearchRequestJson"];
type KnowledgeNodeSearchRequest = components["schemas"]["KnowledgeNodeSearchRequest"];

/** Keyword graph helpers under Layer 0 knowledge. */
export class KnowledgeKeywords {
    private readonly transport: Transport;

    private readonly contextId: string;

    constructor(transport: Transport, contextId: string) {
        this.transport = transport;
        this.contextId = contextId;
    }

    private get base(): string {
        return `${getContextApiPrefix(this.contextId)}/knowledge/keywords`;
    }

    /** Lists keywords with optional filters and pagination. */
    async list(options?: {
        q?: string;
        minDocumentCount?: number;
        sort?: string;
        page?: number;
        pageSize?: number;
    }): Promise<KeywordPageJson> {
        const body = await this.transport.requestJson("GET", this.base, {
            query: options as Record<string, unknown>,
        });
        return body as KeywordPageJson;
    }

    /** Vector search over keyword embeddings. */
    async search(options: {
        query: string;
        k?: number;
        threshold?: number;
    }): Promise<KeywordSearchResponseJson> {
        const payload: KeywordSearchRequestJson = { query: options.query };
        if (options.k !== undefined) payload.k = options.k;
        if (options.threshold !== undefined) payload.threshold = options.threshold;
        const body = await this.transport.requestJson("POST", `${this.base}/search`, {
            body: payload,
        });
        return body as KeywordSearchResponseJson;
    }

    /** Gets one keyword by its normalised form. */
    async get(normalised: string): Promise<KeywordDetailJson> {
        const body = await this.transport.requestJson(
            "GET",
            `${this.base}/${encodePathSegment(normalised)}`,
        );
        return body as KeywordDetailJson;
    }

    /** Co-occurring neighbourhood for a keyword. */
    async related(normalised: string): Promise<TraverseApiResponse> {
        const body = await this.transport.requestJson(
            "GET",
            `${this.base}/${encodePathSegment(normalised)}/related`,
        );
        return body as TraverseApiResponse;
    }

    /** Keywords linked to a document. */
    async forDocument(documentId: string): Promise<DocumentKeywordsResponse["keywords"]> {
        const path = `${getContextApiPrefix(this.contextId)}/knowledge/${encodePathSegment(documentId)}/keywords`;
        const body = await this.transport.requestJson("GET", path);
        return (body as DocumentKeywordsResponse).keywords;
    }
}

/** Typed knowledge-node graph (manual / API imports). */
export class KnowledgeNodes {
    private readonly transport: Transport;

    private readonly contextId: string;

    constructor(transport: Transport, contextId: string) {
        this.transport = transport;
        this.contextId = contextId;
    }

    private get base(): string {
        return `${getContextApiPrefix(this.contextId)}/knowledge/nodes`;
    }

    /** Lists nodes with optional filters. */
    async list(options?: {
        kind?: string;
        q?: string;
        page?: number;
        pageSize?: number;
    }): Promise<KnowledgeNodePageJson> {
        const body = await this.transport.requestJson("GET", this.base, {
            query: options as Record<string, unknown>,
        });
        return body as KnowledgeNodePageJson;
    }

    /** Batch upsert nodes and optional top-level relation rows (server-native shape). */
    async upsert(options: {
        nodes: KnowledgeNodeUpsertRow[];
        relations?: KnowledgeLinkUpsert[];
        scope?: Scope;
    }): Promise<void> {
        const payload: Record<string, unknown> = { nodes: options.nodes };
        if (options.relations) payload.relations = options.relations;
        const sw = serialiseScope(options.scope);
        if (sw) payload.scope = sw;
        await this.transport.requestJson("POST", `${this.base}/batch`, { body: payload });
    }

    /** Semantic search over knowledge nodes. */
    async search(options: {
        query: string;
        k?: number;
        threshold?: number;
        rrfK?: number;
        vectorWeight?: number;
        kindFilter?: string;
    }): Promise<KnowledgeNodeSearchResponseJson> {
        const payload: KnowledgeNodeSearchRequest = {
            query: options.query,
            k: options.k ?? 10,
            threshold: options.threshold ?? 0,
        };
        if (options.rrfK !== undefined) payload.rrfK = options.rrfK;
        if (options.vectorWeight !== undefined) payload.vectorWeight = options.vectorWeight;
        if (options.kindFilter !== undefined) payload.kindFilter = options.kindFilter;
        const body = await this.transport.requestJson("POST", `${this.base}/search`, {
            body: payload,
        });
        return body as KnowledgeNodeSearchResponseJson;
    }

    /** Fetches a node by kind and slug. */
    async get(kind: string, slug: string): Promise<KnowledgeNodeFullJson> {
        const path = `${this.base}/${encodePathSegment(kind)}/${encodePathSegment(slug)}`;
        const body = await this.transport.requestJson("GET", path);
        return body as KnowledgeNodeFullJson;
    }

    /** Related nodes for navigation. */
    async related(
        kind: string,
        slug: string,
        options?: { label?: string; depth?: number },
    ): Promise<TraverseApiResponse> {
        const path = `${this.base}/${encodePathSegment(kind)}/${encodePathSegment(slug)}/related`;
        const q: Record<string, unknown> = {};
        if (options?.label !== undefined) q.label = options.label;
        if (options?.depth !== undefined) q.depth = options.depth;
        const body = await this.transport.requestJson("GET", path, { query: q });
        return body as TraverseApiResponse;
    }

    /** Deletes a node (soft delete on server when applicable). */
    async delete(kind: string, slug: string): Promise<void> {
        const path = `${this.base}/${encodePathSegment(kind)}/${encodePathSegment(slug)}`;
        await this.transport.requestJson("DELETE", path);
    }
}

/** Layer 0 knowledge: documents ingestion, query, graph traversal. */
export class Knowledge {
    private readonly transport: Transport;

    private readonly contextId: string;

    readonly keywords: KnowledgeKeywords;

    readonly nodes: KnowledgeNodes;

    constructor(transport: Transport, contextId: string) {
        this.transport = transport;
        this.contextId = contextId;
        this.keywords = new KnowledgeKeywords(transport, contextId);
        this.nodes = new KnowledgeNodes(transport, contextId);
    }

    private get base(): string {
        return `${getContextApiPrefix(this.contextId)}/knowledge`;
    }

    /**
     * Uploads a document (multipart). `file` may be `File`, `Blob`, `Uint8Array`, or `ReadableStream`.
     */
    async upload(options: {
        file: SpectronFileInput;
        title?: string;
        profile?: IngestProfile | string;
        scope?: Scope;
        filename?: string;
        mimeType?: string;
    }): Promise<UploadResponse> {
        const blob = await spectronFileInputToBlob(options.file, options.mimeType);
        const form = new FormData();
        const name =
            options.filename ??
            (typeof File !== "undefined" && options.file instanceof File
                ? options.file.name
                : "upload");
        form.append("file", blob, name);
        if (options.title !== undefined) form.append("title", options.title);
        if (options.profile !== undefined) form.append("profile", String(options.profile));
        const sw = serialiseScope(options.scope);
        if (sw) form.append("scope", JSON.stringify(sw));
        const body = await this.transport.requestJson("POST", this.base, { body: form });
        return body as UploadResponse;
    }

    /** Replaces document bytes (multipart). */
    async replace(
        documentId: string,
        options: {
            file: SpectronFileInput;
            title?: string;
            profile?: IngestProfile | string;
            filename?: string;
            mimeType?: string;
        },
    ): Promise<UploadResponse> {
        const blob = await spectronFileInputToBlob(options.file, options.mimeType);
        const form = new FormData();
        const name =
            options.filename ??
            (typeof File !== "undefined" && options.file instanceof File
                ? options.file.name
                : "upload");
        form.append("file", blob, name);
        if (options.title !== undefined) form.append("title", options.title);
        if (options.profile !== undefined) form.append("profile", String(options.profile));
        const path = `${this.base}/${encodePathSegment(documentId)}`;
        const body = await this.transport.requestJson("PUT", path, { body: form });
        if (body === null) {
            return {
                id: documentId,
                status: "queued",
                contentHash: "",
                deduplicated: false,
            };
        }
        return body as UploadResponse;
    }

    /** Metadata for one document. */
    async get(documentId: string): Promise<DocumentJson> {
        const body = await this.transport.requestJson(
            "GET",
            `${this.base}/${encodePathSegment(documentId)}`,
        );
        return body as DocumentJson;
    }

    /** Raw document bytes. */
    async raw(documentId: string): Promise<ArrayBuffer> {
        return this.transport.requestBytes(
            "GET",
            `${this.base}/${encodePathSegment(documentId)}/raw`,
        );
    }

    /** Paginated text chunks. */
    async chunks(
        documentId: string,
        options?: { page?: number; pageSize?: number },
    ): Promise<ChunkPageJson> {
        const q: Record<string, unknown> = {};
        if (options?.page !== undefined) q.page = options.page;
        if (options?.pageSize !== undefined) q.page_size = options.pageSize;
        const body = await this.transport.requestJson(
            "GET",
            `${this.base}/${encodePathSegment(documentId)}/chunks`,
            { query: q },
        );
        return body as ChunkPageJson;
    }

    /** Lists documents with optional filters. */
    async list(options?: {
        status?: string;
        mimeType?: string;
        page?: number;
        pageSize?: number;
    }): Promise<DocumentPageJson> {
        const q: Record<string, unknown> = {};
        if (options?.status !== undefined) q.status = options.status;
        if (options?.mimeType !== undefined) q.mime_type = options.mimeType;
        if (options?.page !== undefined) q.page = options.page;
        if (options?.pageSize !== undefined) q.page_size = options.pageSize;
        const body = await this.transport.requestJson("GET", this.base, { query: q });
        return body as DocumentPageJson;
    }

    /** Keywords and neighbours from a document id. */
    async related(documentId: string): Promise<TraverseApiResponse> {
        const body = await this.transport.requestJson(
            "GET",
            `${this.base}/${encodePathSegment(documentId)}/related`,
        );
        return body as TraverseApiResponse;
    }

    /** Deletes a document. */
    async delete(documentId: string): Promise<void> {
        await this.transport.requestJson("DELETE", `${this.base}/${encodePathSegment(documentId)}`);
    }

    /** Hybrid / vector / BM25 / graph knowledge query. */
    async query(
        options: QueryRequestJson & { mode?: QueryMode | string },
    ): Promise<QueryResponseJson> {
        const body = await this.transport.requestJson("POST", `${this.base}/query`, {
            body: options,
        });
        return body as QueryResponseJson;
    }

    /** Multi-edge graph traversal from start nodes. */
    async traverse(options: TraverseApiRequest): Promise<TraverseApiResponse> {
        const body = await this.transport.requestJson("POST", `${this.base}/traverse`, {
            body: options,
        });
        return body as TraverseApiResponse;
    }

    /** Recursive walk along a single edge label. */
    async traverseRecursive(options: {
        start: Record<string, unknown>;
        edge: string;
        maxDepth?: number;
        direction?: string;
    }): Promise<TraverseApiResponse> {
        const body = await this.transport.requestJson("POST", `${this.base}/traverse/recursive`, {
            body: options,
        });
        return body as TraverseApiResponse;
    }

    /** Sibling expansion for a graph neighbourhood. */
    async traverseSiblings(options: {
        start: Record<string, unknown>;
        edge: string;
    }): Promise<TraverseApiResponse> {
        const body = await this.transport.requestJson("POST", `${this.base}/traverse/siblings`, {
            body: options,
        });
        return body as TraverseApiResponse;
    }
}
