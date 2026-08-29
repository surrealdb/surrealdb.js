import { spectronFileInputToBlob } from "../file-body.js";
import { addPageParams, collectPages, type PageOptions } from "../pagination.js";
import { encodePathSegment, getContextApiPrefix } from "../paths.js";
import { normaliseScope, type Scope } from "../scope.js";
import type { Transport, UploadProgressListener } from "../transport.js";
import type { QueryMode, SpectronFileInput } from "../types/domain.js";
import type { components } from "../types/generated.js";

export type DocumentJson = components["schemas"]["DocumentJson"];
export type DocumentPageJson = components["schemas"]["DocumentPageJson"];
export type ChunkJson = components["schemas"]["ChunkJson"];
export type ChunkPageJson = components["schemas"]["ChunkPageJson"];
export type KeywordJson = components["schemas"]["KeywordJson"];
export type UploadResponse = components["schemas"]["UploadResponse"];
export type QueryRequestJson = components["schemas"]["QueryRequestJson"];
export type QueryResponseJson = components["schemas"]["QueryResponseJson"];
export type KeywordPageJson = components["schemas"]["KeywordPageJson"];
export type KeywordSearchResponseJson = components["schemas"]["KeywordSearchResponseJson"];
export type KeywordSearchRequestJson = components["schemas"]["KeywordSearchRequestJson"];
export type KeywordDetailJson = components["schemas"]["KeywordDetailJson"];
export type DocumentKeywordsResponse = components["schemas"]["DocumentKeywordsResponse"];
export type DocumentKeywordJson = components["schemas"]["DocumentKeywordJson"];
export type RecomputeLinksResponse = components["schemas"]["RecomputeLinksResponse"];

/**
 * The pre-cursor offset parameters `/documents`, `/documents/{id}/chunks`, and
 * `/documents/keywords` still accept.
 *
 * Retained for callers with numbered page controls, which need a page index and
 * a total that keyset pagination deliberately does not provide. They pay the
 * scan cost the cursor path avoids, and cannot be combined with `cursor` — the
 * server rejects that pairing with a 400.
 *
 * @deprecated Prefer `limit` + `cursor`.
 */
export interface OffsetPageOptions {
    /** Zero-indexed page number. */
    page?: number;
    /** Rows per page. */
    pageSize?: number;
}

/** The filters `/documents` accepts, beside its pagination parameters. */
export interface DocumentFilters {
    status?: string;
    mimeType?: string;
}

/**
 * Cursor pagination or the deprecated offset pagination, never both.
 *
 * The server rejects `cursor` sent together with `page` with a `400`, so the two
 * modes are modelled as an exclusive union: the invalid pairing fails to
 * type-check instead of surfacing as a runtime error. `limit` and `count` stay
 * available in both arms — only the mode selector is exclusive.
 */
export type CursorOrOffsetOptions =
    | (PageOptions & { page?: never; pageSize?: never })
    | (OffsetPageOptions & Omit<PageOptions, "cursor"> & { cursor?: never });

export type DocumentListOptions = DocumentFilters & CursorOrOffsetOptions;

/** The filters `/documents/keywords` accepts, beside its pagination parameters. */
export interface KeywordFilters {
    q?: string;
    minDocumentCount?: number;
    sort?: string;
}

export type KeywordListOptions = KeywordFilters & CursorOrOffsetOptions;

/**
 * Copies the deprecated offset parameters into a query object. Kept separate
 * from {@link addPageParams} so the two never merge into one option bag: the
 * server rejects `cursor` sent together with `page`.
 */
function addOffsetParams(query: Record<string, unknown>, options?: OffsetPageOptions): void {
    if (options?.page !== undefined) query.page = options.page;
    if (options?.pageSize !== undefined) query.pageSize = options.pageSize;
}
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
    /**
     * Aborts the upload. Rejects with `CancelledError`, which is deliberately
     * distinct from a timeout or a transport failure.
     */
    signal?: AbortSignal;
    /**
     * Observes the request body being sent, so a large upload can show real
     * progress instead of an indefinite spinner.
     *
     * Supplying this switches the request onto `XMLHttpRequest`, the only browser
     * API that reports request-body progress. Without it the upload takes the
     * regular `fetch` path.
     */
    onUploadProgress?: UploadProgressListener;
    /**
     * Deadline for the upload, in milliseconds.
     *
     * Multipart sends have no deadline by default, because a large body can
     * legitimately take longer than any fixed one. Pass a value to bound it.
     */
    timeoutMs?: number;
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

/** The per-request transport options an upload forwards from its own options. */
function sendOptions(options: DocumentUploadOptions) {
    return {
        signal: options.signal,
        onUploadProgress: options.onUploadProgress,
        timeoutMs: options.timeoutMs,
    };
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

    /** Lists one page of keywords with optional filters. */
    async list(options?: KeywordListOptions): Promise<KeywordPageJson> {
        const query: Record<string, unknown> = {};
        if (options?.q !== undefined) query.q = options.q;
        if (options?.minDocumentCount !== undefined) {
            query.minDocumentCount = options.minDocumentCount;
        }
        if (options?.sort !== undefined) query.sort = options.sort;
        addPageParams(query, options);
        addOffsetParams(query, options);
        const body = await this.transport.requestJson("GET", this.base, { query });
        return body as KeywordPageJson;
    }

    /** Every matching keyword, following cursors to exhaustion. */
    async listAll(options?: KeywordFilters & { limit?: number }): Promise<KeywordJson[]> {
        return collectPages((cursor) => this.list({ ...options, cursor }), "keywords");
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
        const body = await this.transport.requestJson("POST", this.base, {
            body: form,
            ...sendOptions(options),
        });
        return body as UploadResponse;
    }

    /** Reprocesses an existing document with replacement bytes (multipart). */
    async reprocess(documentId: string, options: DocumentUploadOptions): Promise<UploadResponse> {
        const form = await buildUploadForm(options);
        const path = `${this.base}/${encodePathSegment(documentId)}`;
        const body = await this.transport.requestJson("PUT", path, {
            body: form,
            ...sendOptions(options),
        });
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
    async raw(documentId: string, options?: { timeoutMs?: number }): Promise<ArrayBuffer> {
        return this.transport.requestBytes(
            "GET",
            `${this.base}/${encodePathSegment(documentId)}/raw`,
            // Downloading a document's bytes is bounded by its size rather than by
            // a round trip, so a large one legitimately outlasts the default
            // deadline. Callers that expect that can raise it.
            options?.timeoutMs !== undefined ? { timeoutMs: options.timeoutMs } : undefined,
        );
    }

    /** Lists one page of a document's text chunks, in document order. */
    async chunks(documentId: string, options?: CursorOrOffsetOptions): Promise<ChunkPageJson> {
        const query: Record<string, unknown> = {};
        addPageParams(query, options);
        addOffsetParams(query, options);
        const body = await this.transport.requestJson(
            "GET",
            `${this.base}/${encodePathSegment(documentId)}/chunks`,
            { query },
        );
        return body as ChunkPageJson;
    }

    /**
     * Every chunk of a document, following cursors to exhaustion.
     *
     * Reconstructing a document's text needs all of it, and `limit` is clamped
     * at 500 server-side, so a single wide page silently truncates anything
     * longer. Pass `max` when only the first N chunks are ever rendered, so a
     * very long document does not cost a page fetch per hundred chunks.
     */
    async allChunks(
        documentId: string,
        options?: { limit?: number; max?: number },
    ): Promise<ChunkJson[]> {
        return collectPages(
            (cursor) => this.chunks(documentId, { limit: options?.limit, cursor }),
            "chunks",
            options?.max,
        );
    }

    /** Lists one page of documents with optional filters. */
    async list(options?: DocumentListOptions): Promise<DocumentPageJson> {
        const query: Record<string, unknown> = {};
        if (options?.status !== undefined) query.status = options.status;
        if (options?.mimeType !== undefined) query.mimeType = options.mimeType;
        addPageParams(query, options);
        addOffsetParams(query, options);
        const body = await this.transport.requestJson("GET", this.base, { query });
        return body as DocumentPageJson;
    }

    /** Every matching document, following cursors to exhaustion. */
    async listAll(options?: DocumentFilters & { limit?: number }): Promise<DocumentJson[]> {
        return collectPages((cursor) => this.list({ ...options, cursor }), "documents");
    }

    /**
     * How many documents match, without fetching them.
     *
     * Asks for a single row with `count: true`, so the total is the only thing
     * paid for beyond one page bound.
     */
    async count(options?: DocumentFilters): Promise<number> {
        const page = await this.list({ ...options, limit: 1, count: true });
        return page.page.totalSize ?? page.documents.length;
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
