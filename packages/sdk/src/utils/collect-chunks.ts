import type { QueryChunk, QueryResponse } from "../types";

/**
 * Collect streamed query chunks into a single array of responses
 *
 * @param stream The chunked response stream
 * @returns Response array
 */
export async function collectChunks<T>(
    stream: AsyncIterable<QueryChunk<T>>,
): Promise<QueryResponse<T>[]> {
    const responses: QueryResponse<T>[] = [];

    for await (const { query, response } of stream) {
        let entry = responses[query];

        if (!entry) {
            entry = { result: [], success: true };
            responses[query] = entry;
        }

        if (!response.success) {
            responses[query] = response;
            continue;
        } else if (!entry.success) {
            continue;
        }

        entry.result.push(...response.result);

        if (response.stats) {
            entry.stats = response.stats;
        }
    }

    return responses;
}
