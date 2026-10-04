import { type ConnectOptions, type DriverOptions, Surreal } from "../../../../sdk/src";
import {
    bearerOf,
    createMockFetch,
    type MockHandler,
    type MockRequest,
    queryResult,
} from "./mock-fetch";

/** What a rejected call is expected to have thrown, for the properties the tests look at */
export type Failure = Error & {
    status?: number;
    cause?: unknown;
    isTokenExpired?: boolean;
    feature?: unknown;
};

/** The error a call is rejected with, which the test is about to look at */
export async function rejection(call: PromiseLike<unknown>): Promise<Failure> {
    try {
        await call;
    } catch (error) {
        return error as Failure;
    }

    throw new Error("Expected the call to be rejected");
}

export const ENDPOINT = "http://mock.test:8000";
export const clients: Surreal[] = [];

/**
 * Answers every query with a result, accepts every sign in with the next token of the list, and
 * lets the test decide which tokens the server accepts.
 */
export function server(options: {
    accept?: (token: string | undefined) => boolean;
    tokens?: string[];
}) {
    const tokens = [...(options.tokens ?? [])];
    const handler: MockHandler = (request) => {
        const method = request.rpc?.method;

        if (method === "signin") {
            return { result: tokens.shift() ?? "signin-token" };
        }

        if (method === "authenticate") {
            return { result: null };
        }

        if (options.accept && !options.accept(bearerOf(request))) {
            return { status: 401 };
        }

        return queryResult({ body: { ok: true }, status: 200 });
    };

    return handler;
}

export async function connect(
    handler: MockHandler,
    authentication: ConnectOptions["authentication"],
    options: Partial<ConnectOptions> = {},
    driver: DriverOptions = {},
) {
    const mock = createMockFetch(handler);
    const db = new Surreal({ fetchImpl: mock.fetchImpl, ...driver });

    clients.push(db);

    await db.connect(ENDPOINT, {
        namespace: "ns",
        database: "db",
        authentication,
        ...options,
    });

    return { db, mock };
}

export const queries = (requests: MockRequest[]) =>
    requests.filter((r) => r.rpc?.method === "query");
export const signins = (requests: MockRequest[]) =>
    requests.filter((r) => r.rpc?.method === "signin");

/** Serializes anything which was observed, including bigints, to look for secrets in it */
export function dump(value: unknown): string {
    return JSON.stringify(value, (_, v) => (typeof v === "bigint" ? v.toString() : v)) ?? "";
}

/** Close every connection which a test opened */
export async function closeClients(): Promise<void> {
    for (const client of clients.splice(0)) {
        await client.close();
    }
}

/** What `fetchSurreal` needs around it, for tests which call it directly */
export function createFetchHarness() {
    const fetched: string[] = [];
    const context = {
        options: {
            fetchImpl: (async (url: URL) => {
                fetched.push(url.toString());
                return new Response("", { status: 200 });
            }) as unknown as typeof fetch,
        },
        codecs: { cbor: { encode: () => new Uint8Array([1]) } },
    } as never;
    const session = { id: undefined, namespace: "ns", database: "db", accessToken: undefined };
    const state = (credentials?: { token: () => Promise<string | undefined> }) =>
        ({ url: new URL("ws://mock.test:8000/rpc"), credentials }) as never;

    return { fetched, context, session: session as never, state };
}
