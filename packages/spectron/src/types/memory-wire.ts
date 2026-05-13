/** @internal Wire shapes for memory endpoints not yet in the OpenAPI snapshot. */

export interface SessionInfoWire {
    id: string;
    scope?: Record<string, string> | null;
    metadata?: Record<string, unknown> | null;
    createdAt?: string | null;
    created_at?: string | null;
}

export interface TurnWire {
    role: string;
    content: string;
    id?: string | null;
    createdAt?: string | null;
    created_at?: string | null;
    metadata?: Record<string, unknown> | null;
}

export interface EntityRefWire {
    type: string;
    name: string;
}

export interface ExtractionResultWire {
    entities?: EntityRefWire[] | null;
    attributes?: unknown[] | null;
    relations?: unknown[] | null;
    instructions?: string[] | null;
    uncertainties?: string[] | null;
    corrections?: unknown[] | null;
    turnId?: string | null;
    turn_id?: string | null;
}

export interface ChatReplyWire {
    reply: string;
    memoryUpdates?: ExtractionResultWire | null;
    memory_updates?: ExtractionResultWire | null;
    turnId?: string | null;
    turn_id?: string | null;
}

export interface ContextResultWire {
    context: string;
    tier?: string | null;
    queryMs?: number | null;
    query_ms?: number | null;
}

export interface MemoryHitWire {
    source: string;
    score: number;
    text?: string | null;
    id?: string | null;
    metadata?: Record<string, unknown> | null;
}

export interface MemoryQueryResponseWire {
    hits: MemoryHitWire[];
    tier?: string | null;
    queryMs?: number | null;
    query_ms?: number | null;
    trace?: Record<string, unknown> | null;
}

export interface StructuredStateWire {
    identity?: Record<string, unknown> | null;
    knowledge?: Record<string, unknown> | null;
    context?: Record<string, unknown> | null;
    instructions?: string[] | null;
    unknowns?: string[] | null;
}

export interface ProfileResponseWire {
    static?: Record<string, unknown> | null;
    dynamic?: Record<string, unknown> | null;
    preferences?: Record<string, unknown> | null;
    instructions?: string[] | null;
}

export interface EntityWire extends EntityRefWire {
    attributes?: Record<string, unknown> | null;
}

export interface EntityHistoryEntryWire {
    value: unknown;
    validFrom?: string | null;
    validUntil?: string | null;
    valid_from?: string | null;
    valid_until?: string | null;
}

export interface ReflectionResultWire {
    reflection: string;
    evidence?: unknown[] | null;
    persistedAttributes?: unknown[] | null;
    persisted_attributes?: unknown[] | null;
}

export interface ForgetResultWire {
    deleted: number;
}

export interface TraceRecordWire {
    id: string;
    [key: string]: unknown;
}

export interface TraceListResponseWire {
    traces: TraceRecordWire[];
}

export interface TraceStatsWire {
    totalQueries?: number | null;
    total_queries?: number | null;
    cacheHits?: number | null;
    cache_hits?: number | null;
    avgLatencyMs?: number | null;
    avg_latency_ms?: number | null;
    tierCounts?: Record<string, number> | null;
    tier_counts?: Record<string, number> | null;
}
