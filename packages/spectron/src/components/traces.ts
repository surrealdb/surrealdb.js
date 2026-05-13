import { encodePathSegment, getContextApiPrefix } from "../paths.js";
import type { Transport } from "../transport.js";
import type {
    TraceListResponseWire,
    TraceRecordWire,
    TraceStatsWire,
} from "../types/memory-wire.js";

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
    async list(options?: { limit?: number }): Promise<TraceRecordWire[]> {
        const body = await this.transport.requestJson("GET", this.base, {
            query: options?.limit !== undefined ? { limit: options.limit } : undefined,
        });
        if (body && typeof body === "object" && "traces" in body) {
            return (body as TraceListResponseWire).traces;
        }
        if (Array.isArray(body)) return body as TraceRecordWire[];
        return [];
    }

    /** Fetches one trace by id. */
    async get(traceId: string): Promise<TraceRecordWire> {
        const body = await this.transport.requestJson(
            "GET",
            `${this.base}/${encodePathSegment(traceId)}`,
        );
        return body as TraceRecordWire;
    }

    /** Aggregate trace statistics. */
    async stats(): Promise<TraceStatsWire> {
        const body = await this.transport.requestJson("GET", `${this.base}/stats`);
        return body as TraceStatsWire;
    }
}
