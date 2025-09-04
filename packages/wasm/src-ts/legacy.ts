import {
    type ConnectionOptions,
    SurrealWasmEngine as Swe,
} from "../compiled/surreal";

import {
    getIncrementalID,
    ConnectionStatus,
    ConnectionUnavailable,
    AbstractEngine,
    EngineAuth,
    UnexpectedConnectionError,
    type EngineEvents,
    type RpcRequest,
    type RpcResponse,
	Engines,
	ExportOptions,
} from "surrealdb";

/**
 * Construct the engines for the SurrealDB WASM implementation. This
 * includes support for `mem` and `indxdb` protocols.
 * 
 * @param opts Configuration options
 * @returns The engines
 */
export function surrealdbWasmEngines(opts?: ConnectionOptions): Engines {

    class WasmEmbeddedEngine extends AbstractEngine {
		
        ready: Promise<void> | undefined = undefined;
        reader?: Promise<void>;
        status: ConnectionStatus = ConnectionStatus.Disconnected;
		queue: (() => Promise<unknown>)[] = [];
		processing = false;
        db?: Swe;

        async version(): Promise<string> {
            return Swe.version();
        }

        setStatus<T extends ConnectionStatus>(
            status: T,
            ...args: EngineEvents[T]
        ) {
            this.status = status;
            this.emitter.emit(status, args);
        }

        async connect(url: URL) {
            this.connection.url = url;
            this.setStatus(ConnectionStatus.Connecting);
			
            const ready = (async () => {
                const db = await Swe.connect(url.toString(), opts).catch(
                    (e) => {
                        console.log(e);
                        const error = new UnexpectedConnectionError(
                            typeof e === "string"
                                ? e
                                : "error" in e
                                  ? e.error
                                  : "An unexpected error occurred",
                        );
                        this.setStatus(ConnectionStatus.Error, error);
                        throw e;
                    },
                );

                this.db = db;
				await this.context.prepare?.(new EngineAuth(this))
                this.setStatus(ConnectionStatus.Connected);

                this.reader = (async () => {
                    const reader = db.notifications().getReader();
                    while (this.connected) {
                        const { done, value } = await reader.read();
                        if (done) break;
                        const raw = value as Uint8Array;
                        const { id, action, result } = this.decodeCbor(
                            raw.buffer,
                        );
                        if (id)
                            this.emitter.emit(
                                `live-${id.toString()}`,
                                [action, result],
                                true,
                            );
                    }
                })();
            })();

            this.ready = ready;
            return await ready;
        }

        async disconnect(): Promise<void> {
            this.connection = {
                url: undefined,
                namespace: undefined,
                database: undefined,
                token: undefined,
            };

            await this.ready;
            this.ready = undefined;
            this.db?.free();
            this.db = undefined;
            await this.reader;
            this.reader = undefined;
			
            if (this.status !== ConnectionStatus.Disconnected) {
                this.setStatus(ConnectionStatus.Disconnected);
            }
        }

        async rpc<
            Method extends string,
            Params extends unknown[] | undefined,
            Result,
        >(request: RpcRequest<Method, Params>): Promise<RpcResponse<Result>> {
            await this.ready;
            if (!this.db) throw new ConnectionUnavailable();

			return new Promise((resolve, reject) => {
				this.queue.push(async () => {
					try {
						const result = await this.execute(request);

						resolve(result as RpcResponse<Result>);
					} catch (error) {
						reject(error);
					}
				});
	
				this.processQueue();
			});
        }

        get connected() {
            return !!this.db;
        }

		async processQueue() {
			if (this.processing) {
				return;
			}
	
			this.processing = true;
	
			while (this.queue.length > 0) {
				const task = this.queue.shift();

				if (task) {
					try {
						await task();
					} catch (error) {
						console.error('Query execution failed', error);
					}
				}
			}
	
			this.processing = false;
		}

		async execute<
			Method extends string,
			Params extends unknown[] | undefined,
			Result,
		>(request: RpcRequest<Method, Params>): Promise<RpcResponse<Result>> {
			// It's not realistic for the message to ever arrive before the listener is registered on the emitter
            // And we don't want to collect the response messages in the emitter
            // So to be sure we simply subscribe before we send the message :)

            const id = getIncrementalID();
            const res: RpcResponse = await this.db
                .execute(new Uint8Array(this.encodeCbor({ id, ...request })))
                .then((raw) => ({ result: this.decodeCbor(raw.buffer) }))
                .catch((message) => ({ error: { code: -1, message } }));

            if ("result" in res) {
                switch (request.method) {
                    case "use": {
                        this.connection.namespace = request
                            .params?.[0] as string;
                        this.connection.database = request
                            .params?.[1] as string;
                        break;
                    }

                    case "signin":
                    case "signup": {
                        this.connection.token = res.result as string;
                        break;
                    }

                    case "authenticate": {
                        this.connection.token = request.params?.[0] as string;
                        break;
                    }

                    case "invalidate": {
                        this.connection.token = undefined;
                        break;
                    }
                }
            }

            return res as RpcResponse<Result>;
		}

		export(options?: Partial<ExportOptions>): Promise<string> {
			return this.db.export(options ? new Uint8Array(this.encodeCbor(options)) : undefined);
		}

		import(input: string): Promise<void> {
			return this.db.import(input);
		}

    }

    return {
        mem: WasmEmbeddedEngine,
        indxdb: WasmEmbeddedEngine,
    };
}