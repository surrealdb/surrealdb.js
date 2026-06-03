/** Inference mode for the `/facts` write API. */
export const InferMode = {
    full: "full",
    triples: "triples",
    preview: "preview",
    none: "none",
} as const;
export type InferMode = (typeof InferMode)[keyof typeof InferMode];

/** Bulk extraction strategy for `/facts/batch`. */
export const BatchExtractionMode = {
    per_message: "per_message",
    whole_conversation: "whole_conversation",
} as const;
export type BatchExtractionMode = (typeof BatchExtractionMode)[keyof typeof BatchExtractionMode];

/** Memory category classification applied during extraction. */
export const MemoryCategory = {
    identity: "identity",
    knowledge: "knowledge",
    context: "context",
} as const;
export type MemoryCategory = (typeof MemoryCategory)[keyof typeof MemoryCategory];

/** Role of a conversation turn participant. */
export const TurnRole = {
    user: "user",
    assistant: "assistant",
    system: "system",
    tool: "tool",
} as const;
export type TurnRole = (typeof TurnRole)[keyof typeof TurnRole];

/** Chunk query mode for `/documents/query`. */
export const QueryMode = {
    hybrid: "hybrid",
    vector: "vector",
    bm25: "bm25",
    hybrid_graph: "hybrid_graph",
} as const;
export type QueryMode = (typeof QueryMode)[keyof typeof QueryMode];

/** Grant verb in the scope permission model. */
export const Verb = {
    read: "read",
    write: "write",
    create_scope: "create_scope",
    delete_scope: "delete_scope",
    grant: "grant",
    manage: "manage",
    forget: "forget",
} as const;
export type Verb = (typeof Verb)[keyof typeof Verb];

/** Scope read breadth for memory queries. */
export const ScopeView = {
    strict: "strict",
    merged: "merged",
    crossTeam: "crossTeam",
} as const;
export type ScopeView = (typeof ScopeView)[keyof typeof ScopeView];

/** Document pipeline status values returned by the API. */
export const DocumentStatus = {
    queued: "queued",
    extracting: "extracting",
    chunking: "chunking",
    embedding: "embedding",
    keywording: "keywording",
    extracting_nodes: "extracting_nodes",
    ready: "ready",
    failed: "failed",
} as const;
export type DocumentStatus = (typeof DocumentStatus)[keyof typeof DocumentStatus];

/** Accepted binary inputs for document uploads. */
export type SpectronFileInput =
    | File
    | Blob
    | Uint8Array
    | ArrayBuffer
    | ArrayBufferView
    | ReadableStream<Uint8Array>;
