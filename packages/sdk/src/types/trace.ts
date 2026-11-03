import type { RecordId, Uuid } from "@surrealdb/sqon";

/**
 * Every kind of trace a query can report, which is what `.trace()` asks for when given none.
 */
export const TRACE_KINDS = [
    "relations",
    "references",
    "links",
    "variables",
    "subscriptions",
] as const;

/**
 * A kind of trace a query can be asked to report on the graph its statements walked.
 *
 * - `relations`: the edges a lookup in a returned position walked
 * - `references`: the references a `<~` lookup in a returned position walked
 * - `links`: the record links the result reads through, such as `author` in `author.name`
 * - `variables`: what each top-level `LET` bound
 * - `subscriptions`: the live queries a `LIVE SELECT` started
 */
export type TraceKind = (typeof TRACE_KINDS)[number];

/**
 * A graph edge a lookup walked. An end is `undefined` where the session cannot read the field of
 * the edge which names it.
 */
export interface TraceRelation {
    in?: RecordId;
    edge: RecordId;
    out?: RecordId;
}

/**
 * A reference a `<~` lookup walked. The record holding the field is the referrer.
 */
export interface TraceReference {
    referrer: RecordId;
    referenced: RecordId;
}

/**
 * A record link the result read through: `field` of `record` pointed at `target`.
 */
export interface TraceLink {
    record: RecordId;
    field: string;
    target: RecordId;
}

/**
 * What a query reported about the graph it walked, for the kinds which were asked for.
 *
 * A part is left out when there is nothing in it, so which parts are present says nothing about
 * which kinds were asked for. A trace belongs to its statement, not to the rows it arrived with.
 *
 * Entries are not deduplicated by the server across frames, so the same entry can arrive more than
 * once for a statement. Entries are told apart by their ids, or by `dedupeTrace()`.
 */
export interface QueryTrace {
    relations?: TraceRelation[];
    references?: TraceReference[];
    links?: TraceLink[];
    /** What each top-level `LET` of the statement bound, by name */
    variables?: Record<string, unknown>;
    /** The live queries the statement started */
    subscriptions?: Uuid[];
    /**
     * A lookup or link fed the result through a position which is not traced, such as a function
     * argument or an aggregate, so what was reported may not be everything which contributed.
     */
    partial?: true;
    /** The kinds whose recording stopped at a limit of the server */
    truncated?: TraceKind[];
}
