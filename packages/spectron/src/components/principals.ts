import { encodePathSegment, getContextApiPrefix } from "../paths.js";
import type { Transport } from "../transport.js";
import type { Verb } from "../types/domain.js";
import type { components } from "../types/generated.js";

type PrincipalJson = components["schemas"]["PrincipalJson"];
type EffectiveGrantsJson = components["schemas"]["EffectiveGrantsJson"];

/** Principals and their scope grants (requires the `manage` grant). */
export class Principals {
    private readonly transport: Transport;

    private readonly contextId: string;

    constructor(transport: Transport, contextId: string) {
        this.transport = transport;
        this.contextId = contextId;
    }

    private get base(): string {
        return `${getContextApiPrefix(this.contextId)}/principals`;
    }

    /** Lists all principals in the context. */
    async list(): Promise<PrincipalJson[]> {
        const body = await this.transport.requestJson("GET", this.base);
        return body as PrincipalJson[];
    }

    /** Fetches a single principal and its declared grants. */
    async get(principalId: string): Promise<PrincipalJson> {
        const body = await this.transport.requestJson(
            "GET",
            `${this.base}/${encodePathSegment(principalId)}`,
        );
        return body as PrincipalJson;
    }

    /** Resolves the verbs a principal effectively holds at a scope path. */
    async effective(
        principalId: string,
        options: { path: string; asOf?: string },
    ): Promise<EffectiveGrantsJson> {
        const query: Record<string, unknown> = { path: options.path };
        if (options.asOf !== undefined) query.asOf = options.asOf;
        const body = await this.transport.requestJson(
            "GET",
            `${this.base}/${encodePathSegment(principalId)}/effective`,
            { query },
        );
        return body as EffectiveGrantsJson;
    }

    /** Grants a principal a set of verbs over a scope pattern. */
    async grant(
        principalId: string,
        options: { path: string; verbs: (Verb | string)[] },
    ): Promise<PrincipalJson> {
        const body = await this.transport.requestJson(
            "POST",
            `${this.base}/${encodePathSegment(principalId)}/grants`,
            { body: { path: options.path, verbs: options.verbs } },
        );
        return body as PrincipalJson;
    }

    /** Revokes a set of verbs from a principal over a scope pattern. */
    async revoke(
        principalId: string,
        options: { path: string; verbs: (Verb | string)[] },
    ): Promise<PrincipalJson> {
        const body = await this.transport.requestJson(
            "DELETE",
            `${this.base}/${encodePathSegment(principalId)}/grants`,
            { body: { path: options.path, verbs: options.verbs } },
        );
        return body as PrincipalJson;
    }
}
