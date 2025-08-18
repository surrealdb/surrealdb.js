import type { QueryChunk } from "../types";
import { jsonify } from "../utils";

// Jsonify the results within a response stream
export async function* jsonifyStream(
    stream: AsyncIterable<QueryChunk<unknown>>,
): AsyncIterable<QueryChunk<unknown>> {
    for await (const chunk of stream) {
        if (chunk.response.success) {
            chunk.response.result = jsonify(chunk.response.result);
        }

        yield chunk;
    }
}
