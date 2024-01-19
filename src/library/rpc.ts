export type RpcRequest<Method extends string = string, Params extends unknown[] | undefined = unknown[]> = {
	method: Method;
	params?: Params
};

export type RpcResponse<Result extends unknown = unknown> = RpcResponseOk<Result> | RpcResponseErr;

export type RpcResponseOk<Result extends unknown = unknown> = {
	result: Result;
	error?: never;
};

export type RpcResponseErr = {
	result?: never;
	error: {
		code: number;
		message: string;
	};
};
