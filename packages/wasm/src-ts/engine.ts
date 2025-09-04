import {
    type ConnectionState,
    type EngineEvents,
    JsonEngine,
    type LiveMessage,
    type RpcRequest,
    type SurrealEngine,
    type Uuid,
} from "surrealdb";

export class WebAssemblyEngine extends JsonEngine implements SurrealEngine {
    open(state: ConnectionState): void {
        throw new Error("Method not implemented.");
    }

    close(): Promise<void> {
        throw new Error("Method not implemented.");
    }

    subscribe<K extends keyof EngineEvents>(
        event: K,
        listener: (...payload: EngineEvents[K]) => void,
    ): () => void {
        throw new Error("Method not implemented.");
    }

    override liveQuery(id: Uuid): AsyncIterable<LiveMessage> {
        throw new Error("Method not implemented.");
    }

    override send<Method extends string, Params extends unknown[] | undefined, Result>(
        request: RpcRequest<Method, Params>,
    ): Promise<Result> {
        throw new Error("Method not implemented.");
    }
}
