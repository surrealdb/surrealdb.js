import type { ConnectionController } from "../../../controller";
import { ConnectionPromise } from "../../../internal/promise";

/**
 * A promise representing a `run` RPC call to the server.
 */
export class RunPromise<T> extends ConnectionPromise<T> {
    #name: string;
    #version?: string;
    #args?: unknown[];

    constructor(
        connection: ConnectionController,
        name: string,
        versionOrArgs?: string | unknown[],
        args?: unknown[],
    ) {
        super(connection);
        this.#name = name;
        if (Array.isArray(versionOrArgs)) {
            this.#args = versionOrArgs;
        } else {
            this.#version = versionOrArgs;
            this.#args = args;
        }
    }

    protected async dispatch(): Promise<T> {
        return await this.rpc("run", [this.#name, this.#version, this.#args]);
    }
}
