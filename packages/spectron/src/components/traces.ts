import { encodePathSegment, getContextApiPrefix } from "../paths.js";
import type { Transport } from "../transport.js";
import type { components } from "../types/generated.js";

type TraceListResponseJson = components["schemas"]["TraceListResponseJson"];
type TraceRecordJson = components["schemas"]["TraceRecordJson"];
type TraceStatsResponseJson = components["schemas"]["TraceStatsResponseJson"];

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

    /** Lists recent trace records. */
    async list(options?: { limit?: number }): Promise<TraceRecordJson[]> {
        const body = await this.transport.requestJson("GET", this.base, {
            query: options?.limit !== undefined ? { limit: options.limit } : undefined,
        });
        return (body as TraceListResponseJson).traces;
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
