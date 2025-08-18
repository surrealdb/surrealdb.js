import type { Jsonify } from "../utils";
import type { QueryChunk, QueryResponse } from "./surreal";

export type MaybeJsonify<T, J extends boolean> = J extends true ? Jsonify<T> : T;
export type QueryOutput = "single" | "results" | "responses" | "chunks";

// chunks - The underlying chunk stream
// responses - The raw responses from the server
// results -

export type MapOutput<T, O extends QueryOutput, J extends boolean> = O extends "chunks"
    ? AsyncIterable<QueryChunk<MaybeJsonify<T, J>>>
    : O extends "responses"
      ? QueryResponse<MaybeJsonify<T, J>>[]
      : O extends "results"
        ? MaybeJsonify<T, J>[]
        : O extends "single"
          ? MaybeJsonify<T, J>
          : never;
