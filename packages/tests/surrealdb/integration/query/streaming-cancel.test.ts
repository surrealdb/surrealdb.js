import { describe, expect, test } from "bun:test";
import { applyDiagnostics, CborCodec, createRemoteEngines, type Surreal } from "surrealdb";
import {
    createIdleSurreal,
    createSurreal,
    requestVersion,
    SURREAL_PASS,
    SURREAL_PROTOCOL,
    SURREAL_USER,
} from "../__helpers__";

/**
 * Abandoning a streamed query has to reach the server, or it carries on executing a query nobody
 * is waiting for, holding a stream and its transaction for as long as it runs.
 *
 * What is checked is the wire: that a `query_cancel` is sent. The caller seeing its own query end
 * proves nothing about that, as the SDK stops waiting on its own either way.
 *
 * Every layer which stands between the caller and the engine has to let the abandoning through
 * promptly, so the same abort is made through each way of configuring one.
 */
describe.if(SURREAL_PROTOCOL === "ws")("abandoning a streamed query", () => {
    /** Whether the server under test serves streaming queries, which is from 3.3.0. */
    async function serverStreams(): Promise<boolean> {
        const { version } = await requestVersion();
        const match = /^(?:surrealdb-)?(\d+)\.(\d+)/.exec(version.trim());

        return (
            !!match && (Number(match[1]) > 3 || (Number(match[1]) === 3 && Number(match[2]) >= 3))
        );
    }

    /** Every request the driver writes to the socket, as the server receives it. */
    function recording() {
        const sent: string[] = [];
        const codec = new CborCodec({});

        class Recording extends WebSocket {
            override send(data: Parameters<WebSocket["send"]>[0]) {
                const request = codec.decode<{ method?: string }>(
                    new Uint8Array(data as ArrayBuffer),
                );

                if (request.method) sent.push(request.method);

                super.send(data);
            }
        }

        return { sent, websocketImpl: Recording as unknown as typeof WebSocket };
    }

    /** Abandons a query which would run for a long time, and returns how long that took. */
    async function abandon(surreal: Surreal, how: "collect" | "stream"): Promise<number> {
        const started = Bun.nanoseconds();
        const query = surreal.query("SLEEP 20s; RETURN 1;").signal(AbortSignal.timeout(300));

        const attempt = (async () => {
            if (how === "collect") {
                await query.collect();
                return;
            }

            for await (const _ of query.stream()) {
                // Nothing arrives before the signal does.
            }
        })();

        await expect(attempt).rejects.toMatchObject({ name: "TimeoutError" });

        return (Bun.nanoseconds() - started) / 1e6;
    }

    const configurations: [string, () => Promise<{ surreal: Surreal; sent: string[] }>][] = [
        [
            "directly",
            async () => {
                const { sent, websocketImpl } = recording();
                const surreal = await createSurreal({ driverOptions: { websocketImpl } });

                return { surreal, sent };
            },
        ],
        [
            "through the diagnostics engines",
            async () => {
                const { sent, websocketImpl } = recording();
                const engines = applyDiagnostics(createRemoteEngines(), () => {});
                const surreal = await createSurreal({ driverOptions: { engines, websocketImpl } });

                return { surreal, sent };
            },
        ],
        [
            "with credentials resolved for each request",
            async () => {
                const { sent, websocketImpl } = recording();
                const { surreal, connect } = await createIdleSurreal({
                    auth: "none",
                    driverOptions: { websocketImpl },
                });

                await connect({
                    authentication: {
                        resolve: () => ({ username: SURREAL_USER, password: SURREAL_PASS }),
                        when: "request",
                    },
                });

                return { surreal, sent };
            },
        ],
    ];

    for (const [name, connect] of configurations) {
        for (const how of ["collect", "stream"] as const) {
            test(`is cancelled on the server, ${name}, read by ${how}()`, async () => {
                if (!(await serverStreams())) return;

                const { surreal, sent } = await connect();

                sent.length = 0;

                const took = await abandon(surreal, how);

                // Cancelling is asked of the server a moment after the caller is told.
                await Bun.sleep(300);

                expect(took).toBeLessThan(3_000);
                expect(sent).toContain("query_stream");
                expect(sent).toContain("query_cancel");
                expect(await surreal.query("RETURN 1").collect()).toEqual([1]);
            });
        }
    }
});
