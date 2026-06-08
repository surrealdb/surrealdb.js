export {
    type ChatOptions,
    type RecallOptions,
    type RememberManyOptions,
    type RememberOptions,
    Spectron,
    type SpectronOptions,
} from "./client.js";
export { DocumentKeywords, Documents, type DocumentUploadOptions } from "./components/documents.js";
export { Entities } from "./components/entities.js";
export { Lifecycle } from "./components/lifecycle.js";
export { Principals } from "./components/principals.js";
export { Scopes } from "./components/scopes.js";
export { Session, Sessions } from "./components/sessions.js";
export { Traces } from "./components/traces.js";
export {
    AuthError,
    ConnectionError,
    errorFromResponse,
    NotFoundError,
    RateLimitError,
    ScopeError,
    ServerError,
    SpectronError,
    ValidationError,
} from "./errors.js";
export { spectronFileInputToBlob } from "./file-body.js";
export { idempotencyKey } from "./idempotency.js";
export { encodePathSegment, getContextApiPrefix } from "./paths.js";
export { backoffSchedule, shouldRetry } from "./retry.js";
export { normaliseScope, type Scope } from "./scope.js";
export { type ChatChunk, parseChatStream } from "./streaming.js";
export { Transport, type TransportOptions } from "./transport.js";
export {
    BatchExtractionMode,
    DocumentStatus,
    InferMode,
    MemoryCategory,
    QueryMode,
    ScopeView,
    type SpectronFileInput,
    TurnRole,
    Verb,
} from "./types/domain.js";
export type { components, operations, paths } from "./types/generated.js";
