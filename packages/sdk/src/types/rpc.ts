import type { RpcErrorObject } from "../internal/parse-error";
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
    kind?: string;
    details?: Record<string, unknown> | null;
};

export type RpcRequest<
    Method extends string = string,
    Params extends unknown[] | undefined = unknown[],
> = {
    method: Method;
    session?: Session;
    params?: Params;
    txn?: Uuid;
};

export type RpcResponse<Result = unknown> = RpcSuccessResponse<Result> | RpcErrorResponse;

export type RpcSuccessResponse<Result = unknown> = {
    result: Result;
    error?: never;
};

export type RpcErrorResponse = {
    result?: never;
    error: RpcErrorObject;
};
