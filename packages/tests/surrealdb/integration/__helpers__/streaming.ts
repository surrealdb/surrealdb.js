import { SURREAL_PASS, SURREAL_PORT, SURREAL_USER } from "./env";

let support: Promise<boolean> | undefined;

/** Whether the server under test serves the streaming query method, asked of it directly. */
export function serverStreams(): Promise<boolean> {
    support ??= probe(Number(SURREAL_PORT)).then((code) => code !== METHOD_NOT_FOUND);
    return support;
}

export const METHOD_NOT_FOUND = -32601;
export const METHOD_NOT_ALLOWED = -32602;

/** The code the server answers a `query_stream` request with, or nothing if it is answered. */
export async function probe(port: number): Promise<number | undefined> {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/rpc`, "json");

    try {
        await new Promise<void>((resolve, reject) => {
            socket.addEventListener("open", () => resolve());
            socket.addEventListener("error", () =>
                reject(new Error("the probe could not connect")),
            );
        });

        const ask = (body: { id: string; method: string; params: unknown[] }) =>
            new Promise<{ id?: string; error?: { code?: number } }>((resolve, reject) => {
                const timer = setTimeout(
                    () => reject(new Error(`${body.id} went unanswered`)),
                    10_000,
                );
                const listener = (event: MessageEvent) => {
                    const response = JSON.parse(event.data as string);

                    if (response.id !== body.id) return;

                    clearTimeout(timer);
                    socket.removeEventListener("message", listener);
                    resolve(response);
                };

                socket.addEventListener("message", listener);
                socket.send(JSON.stringify(body));
            });

        await ask({
            id: "signin",
            method: "signin",
            params: [{ user: SURREAL_USER, pass: SURREAL_PASS }],
        });

        const answer = await ask({ id: "probe", method: "query_stream", params: ["RETURN 1"] });

        return answer.error?.code;
    } finally {
        socket.close();
    }
}
