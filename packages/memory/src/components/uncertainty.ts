import { addPageParams, collectPages, type PageOptions } from "../pagination.js";
import { encodePathSegment, getContextApiPrefix } from "../paths.js";
import type { Transport } from "../transport.js";
import type { components } from "../types/generated.js";

export type UncertaintyJson = components["schemas"]["UncertaintyJson"];
export type UncertaintyListResponseJson = components["schemas"]["UncertaintyListResponseJson"];
export type ResolveUncertaintyResponseJson =
    components["schemas"]["ResolveUncertaintyResponseJson"];

/** Filters and pagination for {@link Uncertainty.list}. */
export interface UncertaintyListOptions extends PageOptions {
    /** Restrict to one subject, as `<type>/<name>`. */
    entity?: string;
    /**
     * Filter on settled state. Unset returns both, so pass `false` for the
     * open flags.
     */
    resolved?: boolean;
}

/** Options for {@link Uncertainty.resolve}. */
export interface ResolveUncertaintyOptions {
    /**
     * Why this value was chosen, persisted as the new row's source clause so
     * the fact reads as an operator decision rather than an unexplained
     * high-trust assertion.
     *
     * Stored normalised and capped, like the value itself — a later read
     * returns that form, not the string as sent.
     */
    note?: string;
}

/**
 * The things this context is unsure about, and the one write that settles one.
 *
 * `/state` collapses these to `{about, reason}`, which is enough to say
 * something is unresolved and not enough to act on it. These rows carry the
 * subject, so a flag can be linked to the entity it is about and settled.
 */
export class Uncertainty {
    private readonly transport: Transport;

    private readonly contextId: string;

    constructor(transport: Transport, contextId: string) {
        this.transport = transport;
        this.contextId = contextId;
    }

    private get base(): string {
        return `${getContextApiPrefix(this.contextId)}/uncertainty`;
    }

    /** Lists one page of uncertainty flags, newest first (`GET /uncertainty`). */
    async list(options?: UncertaintyListOptions): Promise<UncertaintyListResponseJson> {
        const query: Record<string, unknown> = {};
        if (options?.entity !== undefined) query.entity = options.entity;
        if (options?.resolved !== undefined) query.resolved = options.resolved;
        addPageParams(query, options);
        const body = await this.transport.requestJson("GET", this.base, { query });
        return body as UncertaintyListResponseJson;
    }

    /** Every matching flag, following cursors to exhaustion. */
    async listAll(
        options?: Omit<UncertaintyListOptions, "cursor" | "count">,
    ): Promise<UncertaintyJson[]> {
        return collectPages((cursor) => this.list({ ...options, cursor }), "unknowns");
    }

    /**
     * How many flags match, without fetching them.
     *
     * Asks for a single row with `count: true`, so the total is the only thing
     * paid for beyond one page bound.
     */
    async count(options?: { entity?: string; resolved?: boolean }): Promise<number> {
        const page = await this.list({ ...options, limit: 1, count: true });
        return page.page.totalSize ?? page.unknowns.length;
    }

    /**
     * Settles a flag by accepting one value
     * (`POST /uncertainty/{id}/resolve`). Requires the `memory:write` grant.
     *
     * One call, three effects: the flag is claimed, `acceptedValue` is written
     * through the reconciler at the upsert trust prior, and the values it beats
     * are retired. The accepted value lands at the flag's own scope rather than
     * the caller's write anchors, because it has to replace the contenders
     * where they live.
     *
     * Settlement converges on retry rather than being transactional: a failure
     * after the value is written hands the flag back and reports it, and
     * repeating the call dedups the value and finishes the retirement.
     *
     * Only the two reconciler-raised kinds — a cross-provenance contradiction
     * and a confidence-floor hold — record the entity and key a written value
     * would need. A flag without one is refused with a `422`, so check
     * `resolvable` on the row before offering the action; it also accounts for
     * an already-settled flag and for one whose scope reaches beyond the
     * calling key's write region.
     */
    async resolve(
        uncertaintyId: string,
        acceptedValue: string,
        options?: ResolveUncertaintyOptions,
    ): Promise<UncertaintyJson> {
        const payload: Record<string, unknown> = { acceptedValue };
        if (options?.note !== undefined) payload.note = options.note;
        const body = await this.transport.requestJson(
            "POST",
            `${this.base}/${encodePathSegment(uncertaintyId)}/resolve`,
            { body: payload },
        );
        return (body as ResolveUncertaintyResponseJson).uncertainty;
    }
}
