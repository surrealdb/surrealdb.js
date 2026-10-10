import { CborCodec } from "@surrealdb/sqon";
import { Surreal, type TransferProgress } from "surrealdb";

const codec = new CborCodec({});

export type Handler = (init: RequestInit) => Promise<Response> | Response;

export interface Call {
    path: string;
    init: RequestInit;
}

export interface ServerOptions {
    /** The version the server reports */
    version?: string;
    /** Connect as a browser does: through the global `fetch`, with no `fetchImpl` */
    browser?: boolean;
}

const clients: Surreal[] = [];
const realFetch = globalThis.fetch;

/** Close the clients the helpers opened, and take the fakes they installed down */
export async function closeTransfers(): Promise<void> {
    await Promise.all(clients.splice(0).map((db) => db.close()));
    globalThis.fetch = realFetch;
    delete (globalThis as { XMLHttpRequest?: unknown }).XMLHttpRequest;
}

/** A `fetch` which answers every RPC call with the version, and hands the rest to the route */
function fakeFetch(route: Handler, calls: Call[], options: ServerOptions = {}) {
    const answer = new Uint8Array(
        codec.encode({ id: "x", result: `surrealdb-${options.version ?? "3.0.0"}` }),
    );

    return (async (url: URL | string, init: RequestInit = {}) => {
        const path = new URL(url.toString()).pathname;

        if (path.endsWith("/rpc")) return new Response(answer);

        calls.push({ path, init });
        return route(init);
    }) as typeof fetch;
}

/** A Surreal instance on the HTTP engine, whose requests besides RPC calls go to the route */
export async function connect(
    route: Handler = () => new Response("[]"),
    options: ServerOptions = {},
) {
    const calls: Call[] = [];
    const fetchImpl = fakeFetch(route, calls, options);

    if (options.browser) globalThis.fetch = fetchImpl;

    const db = new Surreal(options.browser ? {} : { fetchImpl });

    clients.push(db);
    await db.connect("http://localhost:8000", { versionCheck: false });
    await db.use({ namespace: "test", database: "test" });

    return { db, calls };
}

/** Read an uploaded body as the server would, in full */
export async function received(body: BodyInit | null | undefined): Promise<string> {
    return new Response(body).text();
}

export function recorder() {
    const events: TransferProgress[] = [];
    return { events, callback: (progress: TransferProgress) => events.push(progress) };
}

export function chunked(chunks: string[]): ReadableStream<Uint8Array> {
    const encoder = new TextEncoder();

    return new ReadableStream({
        start(controller) {
            for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
            controller.close();
        },
    });
}

export interface FakeXhrScript {
    status?: number;
    body?: string;
    /** Stall after the upload, until aborted */
    stall?: boolean;
}

export interface FakeXhr {
    method: string;
    url: string;
    headers: Record<string, string>;
    body: Blob | undefined;
    aborted: boolean;
    /** How many characters of the body were downloaded */
    downloaded: number;
}

/** A browser's `XMLHttpRequest`, as far as the upload of an import uses it */
export function installXhr(script: FakeXhrScript = {}): FakeXhr[] {
    const requests: FakeXhr[] = [];

    class Xhr implements FakeXhr {
        method = "";
        url = "";
        headers: Record<string, string> = {};
        body: Blob | undefined;
        aborted = false;
        downloaded = 0;
        withCredentials = false;
        responseType = "";
        response: Blob | null = null;
        status = 0;
        statusText = "";
        readyState = 0;
        upload: { onprogress?: (event: ProgressEvent) => void } = {};
        onreadystatechange?: () => void;
        onload?: () => void;
        onerror?: () => void;
        onabort?: () => void;
        onloadend?: () => void;

        constructor() {
            requests.push(this);
        }

        open(method: string, url: string) {
            this.method = method;
            this.url = url;
        }

        setRequestHeader(name: string, value: string) {
            this.headers[name] = value;
        }

        abort() {
            if (this.readyState === 4) return;

            this.aborted = true;
            this.onabort?.();
            this.onloadend?.();
        }

        send(body: Blob) {
            this.body = body;
            this.#respond(body);
        }

        async #respond(body: Blob) {
            await Promise.resolve();

            const half = Math.floor(body.size / 2);

            for (const loaded of [half, body.size]) {
                this.upload.onprogress?.({
                    loaded,
                    total: body.size,
                    lengthComputable: true,
                } as ProgressEvent);
            }

            if (script.stall || this.aborted) return;

            this.status = script.status ?? 200;
            this.statusText = this.status === 200 ? "OK" : "Unprocessable Entity";
            this.readyState = 2;
            this.onreadystatechange?.();

            // The body arrives later, as it does over a network
            await new Promise((resolve) => setTimeout(resolve, 0));
            if (this.aborted) return;

            const text = script.body ?? "[]";

            this.downloaded = text.length;
            this.response = new Blob([text]);
            this.readyState = 4;
            this.onreadystatechange?.();
            this.onload?.();
            this.onloadend?.();
        }
    }

    (globalThis as { XMLHttpRequest?: unknown }).XMLHttpRequest = Xhr;

    return requests;
}
