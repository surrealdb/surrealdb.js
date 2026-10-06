import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import {
    type ConnectionStatus,
    createRemoteEngines,
    type LiveMessage,
    RecordId,
    Surreal,
    Table,
} from "surrealdb";
import {
    DEMO_TABLE,
    SURREAL_CREDENTIALS,
    SURREAL_DATABASE,
    SURREAL_NAMESPACE,
    SURREAL_URL,
} from "./config";
import { inspectRuntimeCapabilities } from "./polyfills";

interface DemoItem {
    name: string;
    value: number;
}

interface LogEntry {
    id: number;
    kind: "live" | "info" | "error";
    text: string;
}

const MAX_LOG_ENTRIES = 50;

// Interpolating `DEMO_TABLE` is safe here because it is a module constant, not user input.
// Identifiers cannot be supplied as bound parameters in `DEFINE` statements anyway.
const BOOTSTRAP_QUERY = `
    DEFINE NAMESPACE IF NOT EXISTS ${SURREAL_NAMESPACE};
    DEFINE DATABASE IF NOT EXISTS ${SURREAL_DATABASE};
    DEFINE TABLE IF NOT EXISTS ${DEMO_TABLE} SCHEMALESS;
`;

export function App() {
    const client = useRef<Surreal | null>(null);
    const logId = useRef(0);
    const nextRecord = useRef(1);

    const [status, setStatus] = useState<ConnectionStatus>("disconnected");
    const [log, setLog] = useState<LogEntry[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);

    // Lazily created, exactly once. A ref survives React 19 StrictMode's double effect
    // invocation (same fiber, so refs are not reset), so only one client can ever exist.
    // Creating it here rather than at module scope also keeps it strictly after
    // `installPolyfills()` has run in `index.ts`.
    if (client.current === null) {
        client.current = new Surreal({
            engines: createRemoteEngines(),
        });
    }

    const capabilities = useMemo(() => inspectRuntimeCapabilities(), []);
    const missing = useMemo(() => capabilities.filter((entry) => !entry.available), [capabilities]);

    const appendLog = useCallback((kind: LogEntry["kind"], text: string) => {
        logId.current += 1;

        const entry: LogEntry = { id: logId.current, kind, text };

        setLog((entries) => [entry, ...entries].slice(0, MAX_LOG_ENTRIES));
    }, []);

    const reportError = useCallback(
        (cause: unknown) => {
            const text = cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause);

            setError(text);
            appendLog("error", text);
        },
        [appendLog],
    );

    useEffect(() => {
        const db = client.current;

        if (!db) return;

        let disposed = false;
        let detachLive: (() => void) | undefined;

        // Connection state comes from the SDK's own events rather than from the resolution
        // of `connect()`. That is not just tidier: if the connection is closed while
        // `connect()` is in flight, the controller's `ready()` waits on "connected" or
        // "error" and the disconnect handler publishes neither, so the promise never
        // settles. Events always arrive.
        const unsubscribe = [
            db.subscribe("connecting", () => setStatus("connecting")),
            db.subscribe("connected", (version) => {
                setStatus("connected");
                appendLog("info", `Connected to SurrealDB ${version}`);
            }),
            db.subscribe("reconnecting", () => {
                setStatus("reconnecting");
                appendLog("info", "Connection lost, reconnecting");
            }),
            db.subscribe("disconnected", () => setStatus("disconnected")),
            db.subscribe("error", (cause) => reportError(cause)),
        ];

        (async () => {
            try {
                // Namespace, database and credentials go through `connect` so the SDK
                // re-applies them itself on every reconnect - which phones cause a lot of.
                // "connected" is only published once they have been applied, so the status
                // indicator never lies.
                await db.connect(SURREAL_URL, {
                    namespace: SURREAL_NAMESPACE,
                    database: SURREAL_DATABASE,
                    authentication: SURREAL_CREDENTIALS,
                });

                if (disposed) return;

                // SurrealDB 3.x does not create a namespace, database or table on demand,
                // and `LIVE SELECT` against a table which does not exist fails outright.
                // Defining them here is what lets the demo run against a plain
                // `surreal start ... memory` with no manual setup. It needs the root
                // credentials configured in `config.ts`; an app authenticating as a record
                // user would ship this as a migration instead.
                await db.query(BOOTSTRAP_QUERY);

                if (disposed) return;

                // Awaiting `live()` registers the query on the server before any write can
                // be issued, so the first upsert cannot be missed.
                const subscription = await db.live<DemoItem>(new Table(DEMO_TABLE));

                if (disposed) {
                    subscription.kill().catch(() => undefined);
                    return;
                }

                detachLive = subscription.subscribe((message) => {
                    appendLog("live", describeLiveMessage(message));
                });

                appendLog("info", `Live query ${subscription.id.toString()} registered`);
            } catch (cause) {
                if (!disposed) {
                    reportError(cause);
                }
            }
        })();

        return () => {
            disposed = true;

            // Detach the live handler and every event listener first, so nothing can call
            // setState after this point.
            detachLive?.();

            for (const off of unsubscribe) {
                off();
            }

            // Closing the connection terminates every live query registered on it, so an
            // explicit kill() here would only race the socket teardown. The rejection is
            // dropped because there is no longer a UI to show it in.
            db.close().catch(() => undefined);
        };
    }, [appendLog, reportError]);

    const upsertRecord = useCallback(async () => {
        const db = client.current;

        if (!db) return;

        setBusy(true);

        try {
            const id = nextRecord.current;

            nextRecord.current += 1;

            const record = await db.upsert<DemoItem>(new RecordId(DEMO_TABLE, id)).content({
                name: `Item ${id}`,
                // Kept small on purpose: any integer of 2^32 or more routes CBOR through
                // DataView.setBigUint64, whose Hermes support is unconfirmed. See
                // polyfills.ts.
                value: Math.round(Math.random() * 1000),
            });

            appendLog("info", `Upserted ${record.id.toString()}`);
        } catch (cause) {
            reportError(cause);
        } finally {
            setBusy(false);
        }
    }, [appendLog, reportError]);

    // `upsertRecord` reports its own failures, so the promise is intentionally not awaited.
    const handleUpsert = useCallback(() => {
        upsertRecord();
    }, [upsertRecord]);

    const dismissError = useCallback(() => setError(null), []);

    const canWrite = status === "connected" && !busy;

    return (
        <View style={styles.screen}>
            <StatusBar style="light" />

            <Text style={styles.title}>SurrealDB Expo demo</Text>

            <View style={styles.statusRow}>
                <View style={[styles.dot, { backgroundColor: STATUS_COLORS[status] }]} />
                <Text style={styles.status}>{status}</Text>
                <Text
                    numberOfLines={1}
                    style={styles.endpoint}
                >
                    {SURREAL_URL}
                </Text>
            </View>

            {missing.length > 0 && (
                <View style={[styles.banner, styles.warningBanner]}>
                    <Text style={styles.bannerTitle}>Missing runtime capabilities</Text>
                    {missing.map((capability) => (
                        <Text
                            key={capability.name}
                            style={styles.bannerText}
                        >
                            {capability.name} - {capability.detail}
                        </Text>
                    ))}
                </View>
            )}

            {error !== null && (
                <Pressable
                    onPress={dismissError}
                    style={[styles.banner, styles.errorBanner]}
                >
                    <Text style={styles.bannerTitle}>Error (tap to dismiss)</Text>
                    <Text style={styles.bannerText}>{error}</Text>
                </Pressable>
            )}

            <Pressable
                disabled={!canWrite}
                onPress={handleUpsert}
                style={[styles.button, !canWrite && styles.buttonDisabled]}
            >
                <Text style={styles.buttonLabel}>{busy ? "Upserting..." : "Upsert a record"}</Text>
            </Pressable>

            <Text style={styles.sectionTitle}>Notifications (newest first)</Text>

            <ScrollView
                contentContainerStyle={styles.logContent}
                style={styles.log}
            >
                {log.length === 0 ? (
                    <Text style={styles.empty}>Nothing yet.</Text>
                ) : (
                    log.map((entry) => (
                        <Text
                            key={entry.id}
                            style={[styles.entry, ENTRY_STYLES[entry.kind]]}
                        >
                            {entry.text}
                        </Text>
                    ))
                )}
            </ScrollView>
        </View>
    );
}

function describeLiveMessage(message: LiveMessage): string {
    if (message.action === "KILLED") {
        return "KILLED - the live query was terminated by the server";
    }

    return `${message.action} ${message.recordId.toString()} ${JSON.stringify(message.value)}`;
}

const STATUS_COLORS: Record<ConnectionStatus, string> = {
    connected: "#00c48c",
    connecting: "#ffb454",
    reconnecting: "#ffb454",
    disconnected: "#6b6b76",
};

const styles = StyleSheet.create({
    screen: {
        flex: 1,
        backgroundColor: "#0d0d12",
        paddingHorizontal: 16,
        paddingTop: 64,
        paddingBottom: 24,
        gap: 12,
    },
    title: {
        color: "#ffffff",
        fontSize: 22,
        fontWeight: "600",
    },
    statusRow: {
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
    },
    dot: {
        width: 10,
        height: 10,
        borderRadius: 5,
    },
    status: {
        color: "#ffffff",
        fontSize: 14,
        fontWeight: "600",
    },
    endpoint: {
        flex: 1,
        color: "#8a8a94",
        fontSize: 12,
        textAlign: "right",
    },
    banner: {
        borderRadius: 8,
        borderLeftWidth: 3,
        padding: 10,
        gap: 4,
    },
    warningBanner: {
        backgroundColor: "#2a2210",
        borderLeftColor: "#ffb454",
    },
    errorBanner: {
        backgroundColor: "#2a1216",
        borderLeftColor: "#ff4f64",
    },
    bannerTitle: {
        color: "#ffffff",
        fontSize: 13,
        fontWeight: "600",
    },
    bannerText: {
        color: "#d6d6de",
        fontSize: 12,
    },
    button: {
        backgroundColor: "#ff00a0",
        borderRadius: 8,
        paddingVertical: 14,
        alignItems: "center",
    },
    buttonDisabled: {
        backgroundColor: "#3a2a36",
    },
    buttonLabel: {
        color: "#ffffff",
        fontSize: 15,
        fontWeight: "600",
    },
    sectionTitle: {
        color: "#8a8a94",
        fontSize: 12,
        textTransform: "uppercase",
    },
    log: {
        flex: 1,
        backgroundColor: "#15151d",
        borderRadius: 8,
    },
    logContent: {
        padding: 10,
        gap: 6,
    },
    empty: {
        color: "#6b6b76",
        fontSize: 12,
    },
    entry: {
        fontSize: 12,
        fontFamily: "Courier",
    },
    entryLive: {
        color: "#7ee0ff",
    },
    entryInfo: {
        color: "#9a9aa6",
    },
    entryError: {
        color: "#ff8a99",
    },
});

const ENTRY_STYLES: Record<LogEntry["kind"], object> = {
    live: styles.entryLive,
    info: styles.entryInfo,
    error: styles.entryError,
};
