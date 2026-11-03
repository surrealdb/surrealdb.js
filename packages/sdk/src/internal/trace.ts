import type { RecordId, Uuid } from "@surrealdb/sqon";
import {
    type QueryTrace,
    TRACE_KINDS,
    type TraceKind,
    type TraceLink,
    type TraceReference,
    type TraceRelation,
} from "../types/trace";
import type { BoundQuery } from "../utils/bound-query";

/**
 * The kinds a call asks for, checked, in a fixed order and without repeats. Asking for none asks
 * for every kind, which is what `.trace()` with no arguments means.
 */
export function normalizeTraceKinds(kinds: readonly string[]): TraceKind[] {
    for (const kind of kinds) {
        if (!(TRACE_KINDS as readonly string[]).includes(kind)) {
            throw new TypeError(
                `Unknown trace kind "${kind}", expected one of: ${TRACE_KINDS.join(", ")}`,
            );
        }
    }

    const asked = kinds.length > 0 ? kinds : TRACE_KINDS;

    return TRACE_KINDS.filter((kind) => asked.includes(kind));
}

/**
 * The trace a frame or a result carries, read off the wire, where entries are tuples. Anything
 * which is not a trace, or holds nothing, is no trace at all.
 */
export function parseTrace(raw: unknown): QueryTrace | undefined {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return undefined;

    const wire = raw as Record<string, unknown>;
    const trace: QueryTrace = {};

    const relations = entries(wire.relations).flatMap((entry): TraceRelation[] => {
        const [from, edge, out] = entry;
        return edge === undefined || edge === null
            ? []
            : [{ in: optional(from), edge: edge as RecordId, out: optional(out) }];
    });

    if (relations.length > 0) trace.relations = relations;

    const references = entries(wire.references).flatMap((entry): TraceReference[] => {
        const [referrer, referenced] = entry;
        return referrer === undefined || referenced === undefined
            ? []
            : [{ referrer: referrer as RecordId, referenced: referenced as RecordId }];
    });

    if (references.length > 0) trace.references = references;

    const links = entries(wire.links).flatMap((entry): TraceLink[] => {
        const [record, field, target] = entry;
        return record === undefined || typeof field !== "string" || target === undefined
            ? []
            : [{ record: record as RecordId, field, target: target as RecordId }];
    });

    if (links.length > 0) trace.links = links;

    if (
        typeof wire.variables === "object" &&
        wire.variables !== null &&
        Object.keys(wire.variables).length > 0
    ) {
        trace.variables = { ...(wire.variables as Record<string, unknown>) };
    }

    if (Array.isArray(wire.subscriptions) && wire.subscriptions.length > 0) {
        trace.subscriptions = [...(wire.subscriptions as Uuid[])];
    }

    if (wire.partial === true) trace.partial = true;

    if (Array.isArray(wire.truncated)) {
        // A kind this SDK does not know is left out, as an unknown field of a frame is.
        const truncated = (wire.truncated as unknown[]).filter((kind): kind is TraceKind =>
            (TRACE_KINDS as readonly unknown[]).includes(kind),
        );

        if (truncated.length > 0) trace.truncated = truncated;
    }

    return Object.keys(trace).length > 0 ? trace : undefined;
}

/**
 * The `trace` of a chunk, left off it when there is none, so that a chunk which was not asked for
 * one is the same as it was before traces existed.
 */
export function traced(trace: QueryTrace | undefined): { trace?: QueryTrace } {
    return trace ? { trace } : {};
}

/**
 * The entries of one part of a wire trace, each a tuple of record ids and names.
 */
function entries(part: unknown): unknown[][] {
    return Array.isArray(part) ? part.filter(Array.isArray) : [];
}

/**
 * An end of a relation, where `NONE` is a field the session cannot read.
 */
function optional(id: unknown): RecordId | undefined {
    return id === undefined || id === null ? undefined : (id as RecordId);
}

/**
 * Adds the entries of `more` after those of `trace`, as the server's own buffered answer does:
 * nothing is deduplicated, as what a call which collects for the caller owes is what was sent.
 * Either may be absent. Neither is changed.
 */
export function mergeTraces(
    trace: QueryTrace | undefined,
    more: QueryTrace | undefined,
): QueryTrace | undefined {
    if (!more) return trace;
    if (!trace) return more;

    const merged: QueryTrace = {};

    const relations = [...(trace.relations ?? []), ...(more.relations ?? [])];
    if (relations.length > 0) merged.relations = relations;

    const references = [...(trace.references ?? []), ...(more.references ?? [])];
    if (references.length > 0) merged.references = references;

    const links = [...(trace.links ?? []), ...(more.links ?? [])];
    if (links.length > 0) merged.links = links;

    const variables = { ...trace.variables, ...more.variables };
    if (Object.keys(variables).length > 0) merged.variables = variables;

    const subscriptions = [...(trace.subscriptions ?? []), ...(more.subscriptions ?? [])];
    if (subscriptions.length > 0) merged.subscriptions = subscriptions;

    if (trace.partial || more.partial) merged.partial = true;

    const truncated = TRACE_KINDS.filter(
        (kind) => trace.truncated?.includes(kind) || more.truncated?.includes(kind),
    );
    if (truncated.length > 0) merged.truncated = truncated;

    return merged;
}

/**
 * The params of a `query` call: the text and its variables, and the options of the call when it has
 * any. A call with none sends nothing for them, as it always has, so that it is the same as it was
 * for servers which know nothing of options.
 */
export function queryParams(
    query: BoundQuery,
    method: "query" | "gql",
    options?: { trace?: readonly TraceKind[] },
): unknown[] {
    const trace = method === "query" ? options?.trace : undefined;

    return trace && trace.length > 0
        ? [query.query, query.bindings, { trace: [...trace] }]
        : [query.query, query.bindings];
}
