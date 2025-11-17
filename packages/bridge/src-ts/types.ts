import type { LiveAction, LiveMessage, RecordId, Uuid } from "surrealdb";

export interface SurrealBridgeConstructor<T extends SurrealBridge = SurrealBridge> {
    connect(endpoint: string, opts?: unknown | null): Promise<T>;
}

export interface SurrealBridge {
    free(): void;
    yuse(session_id: Uint8Array | null | undefined, ns_db: unknown): Promise<void>;
    version(): string;
    sessions(): Uint8Array[];
    signup(session_id: Uint8Array | null | undefined, params: Uint8Array): Promise<Uint8Array>;
    signin(session_id: Uint8Array | null | undefined, params: Uint8Array): Promise<Uint8Array>;
    authenticate(session_id: Uint8Array | null | undefined, token: string): Promise<void>;
    set(session_id: Uint8Array | null | undefined, name: string, value: Uint8Array): Promise<void>;
    unset(session_id: Uint8Array | null | undefined, name: string): Promise<void>;
    refresh(session_id: Uint8Array | null | undefined, tokens: Uint8Array): Promise<Uint8Array>;
    revoke(tokens: Uint8Array): Promise<void>;
    invalidate(session_id?: Uint8Array | null): Promise<void>;
    reset(session_id?: Uint8Array | null): Promise<void>;
    begin(): Promise<Uint8Array>;
    commit(txn: Uint8Array): Promise<void>;
    cancel(txn: Uint8Array): Promise<void>;
    import(session_id: Uint8Array | null | undefined, sql: string): Promise<void>;
    export(session_id: Uint8Array | null | undefined, config: Uint8Array): Promise<string>;
    query(
        session_id: Uint8Array | null | undefined,
        txn: Uint8Array | null | undefined,
        query: string,
        vars: Uint8Array,
    ): Promise<Uint8Array>;
    notifications(): ReadableStream;
}

export type CapabilitiesAllowDenyList = {
    allow?: boolean | string[];
    deny?: boolean | string[];
};

export type ConnectionOptions = {
    strict?: boolean;
    query_timeout?: number;
    transaction_timeout?: number;
    capabilities?: boolean | {
        scripting?: boolean;
        guest_access?: boolean;
        live_query_notifications?: boolean;
        functions?: boolean | string[] | CapabilitiesAllowDenyList;
        network_targets?: boolean | string[] | CapabilitiesAllowDenyList;
        experimental?: boolean | string[] | CapabilitiesAllowDenyList;
    }
}

export type LiveChannels = Record<string, [LiveMessage]>;
export interface LivePayload {
    id: Uuid;
    action: LiveAction;
    result: LiveMessage;
    record: RecordId;
}