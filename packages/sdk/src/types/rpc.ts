export type RpcQueryResult<T = unknown> = RpcQueryResultOk<T> | RpcQueryResultErr;
export type RpcQueryResultOk<T> = {
    status: "OK";
    time: string;
    result: T;
};

export type RpcQueryResultErr = {
    status: "ERR";
    time: string;
    result: string;
};

export type RpcRequest<
    Method extends string = string,
    Params extends unknown[] | undefined = unknown[],
> = {
    method: Method;
    params?: Params;
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
