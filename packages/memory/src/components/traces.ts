import { addPageParams, collectPages, type PageOptions } from "../pagination.js";
import { encodePathSegment, getContextApiPrefix } from "../paths.js";
import type { Transport } from "../transport.js";
import type { components } from "../types/generated.js";

export type TraceListResponseJson = components["schemas"]["TraceListResponseJson"];
export type TraceRecordJson = components["schemas"]["TraceRecordJson"];
export type TraceStatsResponseJson = components["schemas"]["TraceStatsResponseJson"];

/** Retrieval decision traces for a context. */
export class Traces {
    private readonly transport: Transport;

    private readonly contextId: string;

    constructor(transport: Transport, contextId: string) {
        this.transport = transport;
        this.contextId = contextId;
    }

    private get base(): string {
        return `${getContextApiPrefix(this.contextId)}/traces`;
    }

    /** Lists one page of trace records, newest first. */
    async list(options?: PageOptions): Promise<TraceListResponseJson> {
        const query: Record<string, unknown> = {};
        addPageParams(query, options);
        const body = await this.transport.requestJson("GET", this.base, { query });
        return body as TraceListResponseJson;
    }

    /** Every trace record, following cursors to exhaustion. */
    async listAll(options?: { limit?: number }): Promise<TraceRecordJson[]> {
        return collectPages((cursor) => this.list({ limit: options?.limit, cursor }), "traces");
    }

    /** Fetches one trace by id. */
    async get(traceId: string): Promise<TraceRecordJson> {
        const body = await this.transport.requestJson(
            "GET",
            `${this.base}/${encodePathSegment(traceId)}`,
        );
        return body as TraceRecordJson;
    }

    /** Aggregate trace statistics over the recent window. */
    async stats(): Promise<TraceStatsResponseJson> {
        const body = await this.transport.requestJson("GET", `${this.base}/stats`);
        return body as TraceStatsResponseJson;
    }
}
