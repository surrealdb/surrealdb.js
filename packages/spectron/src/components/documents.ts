import { spectronFileInputToBlob } from "../file-body.js";
import { encodePathSegment, getContextApiPrefix } from "../paths.js";
import { normaliseScope, type Scope } from "../scope.js";
import type { Transport } from "../transport.js";
import type { QueryMode, SpectronFileInput } from "../types/domain.js";
import type { components } from "../types/generated.js";

type DocumentJson = components["schemas"]["DocumentJson"];
type DocumentPageJson = components["schemas"]["DocumentPageJson"];
type ChunkPageJson = components["schemas"]["ChunkPageJson"];
type UploadResponse = components["schemas"]["UploadResponse"];
type QueryRequestJson = components["schemas"]["QueryRequestJson"];
type QueryResponseJson = components["schemas"]["QueryResponseJson"];
type KeywordPageJson = components["schemas"]["KeywordPageJson"];
type KeywordSearchResponseJson = components["schemas"]["KeywordSearchResponseJson"];
type KeywordSearchRequestJson = components["schemas"]["KeywordSearchRequestJson"];
type KeywordDetailJson = components["schemas"]["KeywordDetailJson"];
type DocumentKeywordsResponse = components["schemas"]["DocumentKeywordsResponse"];
type DocumentKeywordJson = components["schemas"]["DocumentKeywordJson"];
type RecomputeLinksResponse = components["schemas"]["RecomputeLinksResponse"];

/** Options shared by document upload and reprocess. */
export interface DocumentUploadOptions {
    /** Binary content. `File`, `Blob`, `Uint8Array`, `ArrayBuffer`, or `ReadableStream`. */
    file: SpectronFileInput;
    /** MIME type for the file part. Defaults to `application/octet-stream`. */
    contentType?: string;
    /** Filename for the multipart `file` part. */
    filename?: string;
    /** Human-readable document title (recorded in the `metadata` part). */
    title?: string;
    /** Source label for the document (recorded in the `metadata` part). */
    source?: string;
    /** DNF scope selector tagging the document (outer OR, inner AND). */
    scopes?: Scope;
    /** Descriptive `key=value` labels stamped onto the document and its chunks. */
    labels?: string[];
}

async function buildUploadForm(options: DocumentUploadOptions): Promise<FormData> {
    const blob = await spectronFileInputToBlob(options.file, options.contentType);
    const form = new FormData();

    // The server reads multipart fields in declaration order, so the metadata
    // part must precede the file part.
    const metadata: Record<string, unknown> = {};
    if (options.title !== undefined) metadata.title = options.title;
    if (options.source !== undefined) metadata.source = options.source;
    const scopes = normaliseScope(options.scopes);
    if (scopes) metadata.scopes = scopes;
    if (options.labels !== undefined) metadata.labels = options.labels;
    if (Object.keys(metadata).length > 0) {
        form.append("metadata", JSON.stringify(metadata));
    }

    const name =
        options.filename ??
        (typeof File !== "undefined" && options.file instanceof File
            ? options.file.name
            : "upload");
    form.append("file", blob, name);
    return form;
}

/** Keyword graph helpers for the document corpus. */
export class DocumentKeywords {
    private readonly transport: Transport;

    private readonly contextId: string;

    constructor(transport: Transport, contextId: string) {
        this.transport = transport;
        this.contextId = contextId;
    }

    private get base(): string {
        return `${getContextApiPrefix(this.contextId)}/documents/keywords`;
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

    /** Keywords linked to a document. */
    async forDocument(documentId: string): Promise<DocumentKeywordJson[]> {
        const path = `${getContextApiPrefix(this.contextId)}/documents/${encodePathSegment(documentId)}/keywords`;
        const body = await this.transport.requestJson("GET", path);
        return (body as DocumentKeywordsResponse).keywords;
    }
}

/** Document ingestion, retrieval, and corpus search. */
export class Documents {
    private readonly transport: Transport;

    private readonly contextId: string;

    /** Keyword graph for the document corpus. */
    readonly keywords: DocumentKeywords;

    constructor(transport: Transport, contextId: string) {
        this.transport = transport;
        this.contextId = contextId;
        this.keywords = new DocumentKeywords(transport, contextId);
    }

    private get base(): string {
        return `${getContextApiPrefix(this.contextId)}/documents`;
    }

    /** Uploads a document (multipart). Returns the ingestion handle. */
    async upload(options: DocumentUploadOptions): Promise<UploadResponse> {
        const form = await buildUploadForm(options);
        const body = await this.transport.requestJson("POST", this.base, { body: form });
        return body as UploadResponse;
    }

    /** Reprocesses an existing document with replacement bytes (multipart). */
    async reprocess(documentId: string, options: DocumentUploadOptions): Promise<UploadResponse> {
        const form = await buildUploadForm(options);
        const path = `${this.base}/${encodePathSegment(documentId)}`;
        const body = await this.transport.requestJson("PUT", path, { body: form });
        if (body === null) {
            return { id: documentId, status: "queued", contentHash: "", deduplicated: false };
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

    /** Deletes a document. */
    async delete(documentId: string): Promise<void> {
        await this.transport.requestJson("DELETE", `${this.base}/${encodePathSegment(documentId)}`);
    }

    /** Hybrid / vector / BM25 / graph search over the document corpus. */
    async query(
        options: QueryRequestJson & { mode?: QueryMode | string },
    ): Promise<QueryResponseJson> {
        const body = await this.transport.requestJson("POST", `${this.base}/query`, {
            body: options,
        });
        return body as QueryResponseJson;
    }

    /** Recomputes derived document↔keyword and document↔document links. */
    async recomputeLinks(): Promise<RecomputeLinksResponse> {
        const body = await this.transport.requestJson("POST", `${this.base}/recompute-links`, {
            body: {},
        });
        return body as RecomputeLinksResponse;
    }
}
