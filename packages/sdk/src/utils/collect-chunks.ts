import type { QueryChunk, QueryResponse } from "../types";

/**
 * Collect streamed query chunks into a single array of responses
 *
 * @param stream The chunked response stream
 * @returns Response array
 */
export async function collectResponses<T>(
    stream: AsyncIterable<QueryChunk<T>>,
): Promise<QueryResponse<T>[]> {
    const responses: QueryResponse<T>[] = [];

    for await (const { query, response } of stream) {
        let entry = responses[query];

        if (entry) {
            if (!entry.success) {
                continue;
            }

            if (!response.success) {
                responses[query] = response;
                continue;
            }

            if (Array.isArray(entry.result) && Array.isArray(response.result)) {
                entry.result.push(...response.result);
            } else {
                entry.result = response.result;
            }

            if (response.stats) {
                entry.stats = response.stats;
            }
        }

        if (!entry) {
            entry = response;
            responses[query] = entry;
        }
    }

    return responses;
}
