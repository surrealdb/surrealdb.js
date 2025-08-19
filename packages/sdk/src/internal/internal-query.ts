import type { ConnectionController } from "../controller";
import { ResponseError, SurrealError } from "../errors";
import type { BoundQuery } from "../utils";
import { collectResponses } from "../utils/collect-chunks";
import type { Uuid } from "../value";
import { jsonifyStream } from "./jsonify-stream";

export async function internalQuery<T>(
    connection: ConnectionController,
    query: BoundQuery,
    json: boolean = false,
    transaction?: Uuid,
): Promise<T> {
    let chunks = connection.query(query.query, query.bindings, transaction);

    if (json) {
        chunks = jsonifyStream(chunks);
    }

    const [response] = await collectResponses(chunks);

    if (!response) {
        throw new SurrealError("No response from auxiliary query");
    }

    if (!response.success) {
        throw new ResponseError(response);
    }

    return response.result as T;
}
