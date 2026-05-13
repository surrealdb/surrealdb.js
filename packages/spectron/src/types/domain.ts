/** Knowledge query mode for Layer 0 search. */
export const QueryMode = {
    vector: "vector",
    bm25: "bm25",
    hybrid: "hybrid",
    hybrid_graph: "hybrid_graph",
} as const;
export type QueryMode = (typeof QueryMode)[keyof typeof QueryMode];

/** Document pipeline status values returned by the API. */
export const DocumentStatus = {
    queued: "queued",
    extracting: "extracting",
    chunking: "chunking",
    embedding: "embedding",
    rendering: "rendering",
    transcribing: "transcribing",
    captioning: "captioning",
    keywording: "keywording",
    ready: "ready",
    failed: "failed",
} as const;
export type DocumentStatus = (typeof DocumentStatus)[keyof typeof DocumentStatus];

/** Multimodal ingestion profile for document upload. */
export const IngestProfile = {
    text_only: "text_only",
    text_plus_ocr: "text_plus_ocr",
    multimodal_balanced: "multimodal_balanced",
    multimodal_full: "multimodal_full",
} as const;
export type IngestProfile = (typeof IngestProfile)[keyof typeof IngestProfile];

/** Role of a message in a session turn. */
export const TurnRole = {
    user: "user",
    assistant: "assistant",
    system: "system",
    tool: "tool",
} as const;
export type TurnRole = (typeof TurnRole)[keyof typeof TurnRole];

/** Memory category for structured updates. */
export const MemoryCategory = {
    identity: "identity",
    knowledge: "knowledge",
    context: "context",
    instruction: "instruction",
    uncertainty: "uncertainty",
} as const;
export type MemoryCategory = (typeof MemoryCategory)[keyof typeof MemoryCategory];

/** Accepted binary inputs for knowledge uploads. */
export type SpectronFileInput =
    | File
    | Blob
    | Uint8Array
    | ArrayBuffer
    | ArrayBufferView
    | ReadableStream<Uint8Array>;
