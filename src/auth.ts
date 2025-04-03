import type { AbstractEngine } from "./engines/abstract";
import { NoActiveSocket, NoTokenReturned, ResponseError } from "./errors";
import {
	type AccessRecordAuth,
	type AnyAuth,
	type RpcResponse,
	type ScopeAuth,
	type Token,
	convertAuth,
} from "./types";
import { processAuthVars } from "./util/process-auth-vars";

export abstract class AuthController {
	abstract connection: AbstractEngine | undefined;

	abstract rpc<Result>(
		method: string,
		params?: unknown[],
	): Promise<RpcResponse<Result>>;

	/**
	 * Signs up to a specific authentication scope.
	 * @param vars - Variables used in a signup query.
	 * @return The authentication token.
	 */
	async signup(vars: ScopeAuth | AccessRecordAuth): Promise<Token> {
		if (!this.connection) throw new NoActiveSocket();

		const parsed = processAuthVars(vars, this.connection.connection);
		const converted = convertAuth(parsed);
		const res = await this.rpc<Token>("signup", [converted]);

		if (res.error) throw new ResponseError(res.error.message);
		if (!res.result) {
			throw new NoTokenReturned();
		}

		return res.result;
	}

	/**
	 * Signs in to a specific authentication scope.
	 * @param vars - Variables used in a signin query.
	 * @return The authentication token.
	 */
	async signin(vars: AnyAuth): Promise<Token> {
		if (!this.connection) throw new NoActiveSocket();

		const parsed = processAuthVars(vars, this.connection.connection);
		const converted = convertAuth(parsed);
		const res = await this.rpc<Token>("signin", [converted]);

		if (res.error) throw new ResponseError(res.error.message);
		if (!res.result) {
			throw new NoTokenReturned();
		}

		return res.result;
	}

	/**
	 * Authenticates the current connection with a JWT token.
	 * @param token - The JWT authentication token.
	 */
	async authenticate(token: Token): Promise<true> {
		const res = await this.rpc<string>("authenticate", [token]);
		if (res.error) throw new ResponseError(res.error.message);
		return true;
	}

	/**
	 * Invalidates the authentication for the current connection.
	 */
	async invalidate(): Promise<true> {
		const res = await this.rpc("invalidate");
		if (res.error) throw new ResponseError(res.error.message);
		return true;
	}
}

export class EngineAuth extends AuthController {
	constructor(public connection: AbstractEngine) {
		super();
	}

	rpc<Result>(
		method: string,
		params?: unknown[],
	): Promise<RpcResponse<Result>> {
		if (!this.connection) throw new NoActiveSocket();

		return this.connection.rpc<typeof method, typeof params, Result>({
			method,
			params,
		});
	}
}
