import type { ConnectionController } from "../controller";
import { FutureDispatchedError, ResponseError } from "../errors";
import type { RpcResponse } from "../types";

type OnFulfilled<T, TResult> =
	| ((value: T) => TResult | PromiseLike<TResult>)
	| null
	| undefined;

type OnRejected<TResult> =
	| ((reason: unknown) => TResult | PromiseLike<TResult>)
	| null
	| undefined;

type OnFinally = (() => void) | null | undefined;

/**
 * A form of `Promise` that allows you to configure the eventual execution
 * of a task by mutating state.
 */
export abstract class Future<T, S extends Record<string, unknown>>
	implements PromiseLike<T>, Promise<T>
{
	#dispatched = false;

	protected _state: S = {} as S;

	abstract dispatch(): Promise<T>;

	then<TResult1 = T, TResult2 = never>(
		onfulfilled?: OnFulfilled<T, TResult1>,
		onrejected?: OnRejected<TResult2>,
	): Promise<TResult1 | TResult2> {
		if (this.#dispatched) {
			throw new FutureDispatchedError();
		}
		this.#dispatched = true;
		return this.dispatch().then(onfulfilled, onrejected);
	}

	catch<TResult = never>(
		onrejected?: OnRejected<TResult>,
	): Promise<T | TResult> {
		if (this.#dispatched) {
			throw new FutureDispatchedError();
		}
		this.#dispatched = true;
		return this.dispatch().catch(onrejected);
	}

	finally(onfinally?: OnFinally): Promise<T> {
		if (this.#dispatched) {
			throw new FutureDispatchedError();
		}
		this.#dispatched = true;
		return this.dispatch().finally(onfinally);
	}

	[Symbol.toStringTag] = "Future";
}

/**
 * A `Future` that is bound to a specific connection.
 * It can be used to execute tasks that require a connection context.
 */
export abstract class ConnectionFuture<
	T,
	S extends Record<string, unknown> = Record<string, unknown>,
> extends Future<T, S> {
	protected _connection: ConnectionController;

	constructor(connection: ConnectionController) {
		super();
		this._connection = connection;
	}

	protected async rpc<Result>(
		method: string,
		params?: unknown[],
	): Promise<Result> {
		const { result, error } = (await this._connection.rpc({
			method,
			params,
		})) as RpcResponse<Result>;

		if (error) {
			throw new ResponseError(error.message);
		}

		return result;
	}

	[Symbol.toStringTag] = "ConnectionFuture";
}
