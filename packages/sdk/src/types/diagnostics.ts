import type { Duration, Uuid } from "../value";
import type { Nullable } from "./helpers";
import type { LiveMessage } from "./live";
import type { NamespaceDatabase, QueryChunk, Session, VersionInfo } from "./surreal";

type AuthVariant = "system_user" | "token" | "record_access" | "bearer_access";
type SessionInfo = { session: Session };
type AuthInfo = { variant: AuthVariant };
type UseInfo = { requested: Nullable<NamespaceDatabase> };
type SetInfo = { name: string; value: unknown };
type UnsetInfo = { name: string };
type LiveQueryInfo = { id: Uuid; message?: LiveMessage };
type QueryInfo = {
    query: string;
    params: Record<string, unknown>;
    transaction?: Uuid;
    chunk?: QueryChunk<unknown>;
};

type DiagnosticMap = {
    query: QueryInfo & SessionInfo;
    liveQuery: LiveQueryInfo;
    version: VersionInfo;
    signup: AuthInfo & SessionInfo;
    signin: AuthInfo & SessionInfo;
    authenticate: AuthInfo & SessionInfo;
    open: undefined;
    close: undefined;
    health: undefined;
    use: UseInfo & SessionInfo;
    set: SetInfo & SessionInfo;
    unset: UnsetInfo & SessionInfo;
    invalidate: SessionInfo;
    reset: SessionInfo;
    sessions: Uuid[];
    importSql: undefined;
    exportSql: undefined;
    exportMlModel: undefined;
};

export type DiagnosticKey = keyof DiagnosticMap;
export type DiagnosticResult<T extends DiagnosticKey> = DiagnosticMap[T];

export type DiagnosticEvent<T extends DiagnosticKey> =
    | {
          type: T;
          key: Uuid;
          phase: "before";
      }
    | {
          type: T;
          key: Uuid;
          phase: "progress";
          result: DiagnosticResult<T>;
      }
    | { type: T; key: Uuid; phase: "after"; duration: Duration; success: false; error: Error }
    | {
          type: T;
          key: Uuid;
          phase: "after";
          duration: Duration;
          success: true;
          result: DiagnosticResult<T>;
      };

export type Diagnostic = {
    [K in keyof DiagnosticMap]: DiagnosticEvent<K>;
}[keyof DiagnosticMap];
