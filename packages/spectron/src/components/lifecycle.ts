import { getContextApiPrefix } from "../paths.js";
import type { Transport } from "../transport.js";
import type { components } from "../types/generated.js";

type LifecycleResponseJson = components["schemas"]["LifecycleResponseJson"];

/** Operator lifecycle sweeps (expiry and decay). */
export class Lifecycle {
    private readonly transport: Transport;

    private readonly contextId: string;

    constructor(transport: Transport, contextId: string) {
        this.transport = transport;
        this.contextId = contextId;
    }

    private get base(): string {
        return `${getContextApiPrefix(this.contextId)}/lifecycle`;
    }

    /** Runs the context-category expiry sweep. Returns the number of affected rows. */
    async expire(): Promise<LifecycleResponseJson> {
        const body = await this.transport.requestJson("POST", `${this.base}/expire`, { body: {} });
        return body as LifecycleResponseJson;
    }

    /** Runs the importance decay sweep. Returns the number of affected rows. */
    async decay(): Promise<LifecycleResponseJson> {
        const body = await this.transport.requestJson("POST", `${this.base}/decay`, { body: {} });
        return body as LifecycleResponseJson;
    }
}
