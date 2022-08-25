export interface SurrealResult {
    result: any;
    error?: {
        message: string;
    };
}

export interface WebSocketEvent {
    data: any;
}

export interface WebSocketMessage {
    data: any;
    params: any[];
}

export type SurrealArgs = [any];

export enum SurrealOperation {
    Create = "create",
    Update = "update",
    Delete = "delete",
    Change = "change",
    Modify = "modify",
    Select = "select",
}