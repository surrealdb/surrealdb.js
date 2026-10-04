import {
    type ConnectionState,
    type ConnectOptions,
    type DriverContext,
    type EngineEvents,
    Features,
    Publisher,
    RpcEngine,
    type RpcRequest,
    Surreal,
    type SurrealEngine,
} from "../../../../sdk/src";
import type { Feature } from "../../../../sdk/src/internal/feature";

export type Handler = (request: RpcRequest) => unknown;

/**
 * An engine which keeps credentials in a session on the other side, as the WebSocket engine
 * does, and answers requests as the test tells it to.
 */
export class SessionEngine extends RpcEngine implements SurrealEngine {
    static last: SessionEngine | undefined;
    static handler: Handler = () => undefined;

    readonly sent: RpcRequest[] = [];
    readonly #publisher = new Publisher<EngineEvents>();

    features = new Set<Feature>([Features.Sessions, Features.Transactions]);

    constructor(context: DriverContext) {
        super(context);
        SessionEngine.last = this;
    }

    subscribe<K extends keyof EngineEvents>(
        event: K,
        listener: (...payload: EngineEvents[K]) => void,
    ): () => void {
        return this.#publisher.subscribe(event, listener);
    }

    open(state: ConnectionState): void {
        this._state = state;
        // Not a timer, so that connecting works with faked ones
        queueMicrotask(() => this.#publisher.publish("connected"));
    }

    async close(): Promise<void> {
        this._state = undefined;
        this.#publisher.publish("disconnected");
    }

    ready(): void {}

    /** The connection is lost, and established again. Everything the server held is gone. */
    reconnect(): void {
        this.#publisher.publish("reconnecting");
        this.#publisher.publish("connected");
    }

    override async send<Method extends string, Params extends unknown[] | undefined, Result>(
        request: RpcRequest<Method, Params>,
    ): Promise<Result> {
        this.sent.push(request as RpcRequest);

        return (await SessionEngine.handler(request as RpcRequest)) as Result;
    }

    override liveQuery(): never {
        throw new Error("not supported");
    }

    methods(): string[] {
        return this.sent.map((request) => request.method).filter((m) => m !== "version");
    }
}

const clients: Surreal[] = [];

/**
 * Answers like a server: queries return a result, a token is authenticated if the test says
 * so, and signing in hands out the next of the provided tokens.
 */
export function serve(options: { tokens?: string[]; authenticate?: Handler } = {}): Handler {
    const tokens = [...(options.tokens ?? [])];

    return (request) => {
        switch (request.method) {
            case "version":
                return "surrealdb-3.0.0";
            case "query":
                return [{ status: "OK", time: "1ms", result: [] }];
            case "signin":
                return tokens.shift() ?? "signin-token";
            case "authenticate":
                return options.authenticate?.(request) ?? null;
            default:
                return undefined;
        }
    };
}

export async function connect(
    handler: Handler,
    authentication: ConnectOptions["authentication"],
    options: Partial<ConnectOptions> = {},
    fetchImpl?: typeof fetch,
) {
    SessionEngine.handler = handler;

    const db = new Surreal({
        engines: { fake: (context) => new SessionEngine(context) },
        fetchImpl,
    });

    clients.push(db);

    await db.connect("fake://server", {
        namespace: "ns",
        database: "db",
        authentication,
        ...options,
    });

    return { db, engine: SessionEngine.last as SessionEngine };
}

/** Close every connection which a test opened, and forget how the server answers */
export async function closeSessionClients(): Promise<void> {
    SessionEngine.handler = () => undefined;

    for (const client of clients.splice(0)) {
        await client.close();
    }
}

/** Poll until the condition holds, which is how long things which happen on a timer are awaited */
export async function until(condition: () => boolean, timeout = 5000): Promise<void> {
    const start = Date.now();

    while (!condition()) {
        if (Date.now() - start > timeout) throw new Error("The condition was not met in time");
        await Bun.sleep(20);
    }
}
