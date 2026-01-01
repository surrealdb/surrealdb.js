import type { Uuid } from "../value";
import type { QueryType, Session } from "./surreal";

export type RpcQueryResult<T = unknown> = RpcQueryResultOk<T> | RpcQueryResultErr;
export type RpcQueryResultOk<T> = {
    status: "OK";
    time: string;
    result: T;
    type: QueryType;
};

export type RpcQueryResultErr = {
    status: "ERR";
    time: string;
    result: string;
};

/**
 * RPC protocol version to use when communicating with SurrealDB.
 * - Version 1: Default for SurrealDB v2.x
 * - Version 2: Required for SurrealDB v3.x (introduces new auth response format, statement options)
 */
export type RpcProtocolVersion = 1 | 2;

export type RpcRequest<
    Method extends string = string,
    Params extends unknown[] | undefined = unknown[],
> = {
    method: Method;
    session?: Session;
    params?: Params;
    txn?: Uuid;
    /**
     * RPC protocol version. When omitted, defaults to version 1.
     * Set to 2 for SurrealDB v3.x servers.
     */
    version?: RpcProtocolVersion;
};

export type RpcResponse<Result = unknown> = RpcSuccessResponse<Result> | RpcErrorResponse;

export type RpcSuccessResponse<Result = unknown> = {
    result: Result;
    error?: never;
};

export type RpcErrorResponse = {
    result?: never;
    error: {
        code: number;
        message: string;
    };
};
