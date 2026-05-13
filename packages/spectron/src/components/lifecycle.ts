import { getContextApiPrefix } from "../paths.js";
import type { Transport } from "../transport.js";

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

    /** Runs context-category expiry sweep. */
    async expire(): Promise<void> {
        await this.transport.requestJson("POST", `${this.base}/expire`, { body: {} });
    }

    /** Runs importance decay sweep. */
    async decay(): Promise<void> {
        await this.transport.requestJson("POST", `${this.base}/decay`, { body: {} });
    }
}
