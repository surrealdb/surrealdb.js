import { CborCodec } from "../../../../sdk/src";

const codec = new CborCodec({});

/**
 * A request as received by the mock server.
 */
export interface MockRequest {
    url: string;
    method: string;
    headers: Record<string, string>;
    init: RequestInit;
    /** The decoded RPC request, for requests to the RPC endpoint */
    rpc?: { id: string; method: string; params?: unknown[]; session?: unknown };
    /** The body of the request exactly as it was sent */
    body: Uint8Array | undefined;
}

/**
 * What the mock server answers with.
 */
export type MockReply =
    | { result: unknown }
    | { error: { code: number; message: string; kind?: string; details?: unknown } }
    | { status: number };

export type MockHandler = (request: MockRequest) => MockReply | Promise<MockReply>;

/**
 * A `fetch` implementation which speaks just enough of the SurrealDB HTTP protocol to drive
 * the SDK, and records what it was asked. `version` is always answered; everything else is up to
 * the handler.
 */
export function createMockFetch(handler: MockHandler) {
    const requests: MockRequest[] = [];

    const fetchImpl = (async (input: string | URL | Request, init: RequestInit = {}) => {
        const headers: Record<string, string> = {};

        for (const [name, value] of Object.entries(init.headers ?? {})) {
            headers[name] = value;
        }

        let body: Uint8Array | undefined;
        let rpc: MockRequest["rpc"];

        if (init.body instanceof Uint8Array) {
            body = init.body;
            rpc = codec.decode(body) as MockRequest["rpc"];
        }

        const request: MockRequest = {
            url: input.toString(),
            method: init.method ?? "GET",
            headers,
            init,
            rpc,
            body,
        };

        requests.push(request);

        const reply: MockReply =
            rpc?.method === "version" ? { result: "surrealdb-3.0.0" } : await handler(request);

        if ("status" in reply) {
            return new Response(null, { status: reply.status });
        }

        const payload = new Uint8Array(codec.encode({ id: rpc?.id, ...reply }));

        return new Response(payload, { status: 200 });
    }) as typeof fetch;

    return {
        fetchImpl,
        requests,
        /** The requests which were not asked for the version */
        get calls(): MockRequest[] {
            return requests.filter((request) => request.rpc?.method !== "version");
        },
    };
}

/**
 * The statement results of a successful `query` RPC.
 */
export function queryResult(...results: unknown[]): MockReply {
    return {
        result: results.map((result) => ({ status: "OK", time: "1ms", result })),
    };
}

/**
 * Build an unsigned JWT with the provided claims.
 */
export function createJwt(claims: Record<string, unknown>): string {
    const encode = (value: unknown) => btoa(JSON.stringify(value));

    return `${encode({ alg: "HS512", typ: "JWT" })}.${encode(claims)}.signature`;
}

/**
 * Build a JWT which expires the provided amount of seconds from the current time.
 */
export function createJwtExpiringIn(seconds: number, id: string = crypto.randomUUID()): string {
    return createJwt({ exp: Math.floor(Date.now() / 1000) + seconds, id });
}

/**
 * The bearer token a request carried.
 */
export function bearerOf(request: MockRequest): string | undefined {
    return request.headers.Authorization?.replace(/^Bearer /, "");
}

/**
 * A promise whose settlement is controlled by the test.
 */
export function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });

    return { promise, resolve, reject };
}
