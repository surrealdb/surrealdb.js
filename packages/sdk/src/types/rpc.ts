import type { RecordId } from "../value";
import type { Prettify } from "./helpers";

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

export type ActionResult<T extends Record<string, unknown>> = Prettify<
    T["id"] extends RecordId ? T : { id: RecordId } & T
>;
