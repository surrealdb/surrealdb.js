import type { RpcQueryResult } from "../types";
import type { QueryChunk } from "../types/surreal";
import { Duration } from "../value";

export async function *chunkedRpcResponse<T>(responses: RpcQueryResult[]): AsyncIterable<QueryChunk<T>> {
    let index = 0;
    for (const response of responses) {
        const chunk: QueryChunk<T> = {
            query: index++,
            batch: 0,
            kind: "single",
            stats: {
                bytesReceived: -1,
                bytesScanned: -1,
                recordsReceived: -1,
                recordsScanned: -1,
                duration: new Duration(response.time),
            },
        };

        if (response.status === "OK") {
            chunk.type = response.type;

            if (Array.isArray(response.result)) {
                chunk.kind = "batched-final";
                chunk.result = response.result as T[];
            } else {
                chunk.result = [response.result] as T[];
            }
        } else {
            chunk.error = {
                code: Number(response.result) || 0,
                message: String(response.result),
            };
        }

        yield chunk;
    }
}