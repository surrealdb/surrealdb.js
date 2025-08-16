import type { Observable } from "rxjs";
import type { QueryChunk, QueryResponse } from "../types";

export async function collectChunks<T>(stream: Observable<QueryChunk<T>>): Promise<QueryResponse<T>[]> {
	// const reader = stream.getReader();
	const responses: QueryResponse<T>[] = [];

	// while (true) {
	// 	const { done, value } = await reader.read();
	// 	if (done) break;
	// 	responses.push(value);
	// }

	return responses;
}