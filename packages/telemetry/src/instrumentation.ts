import { SpanKind, SpanStatusCode } from "@opentelemetry/api";
import {
    InstrumentationBase,
    type InstrumentationConfig,
    InstrumentationNodeModuleDefinition,
    isWrapped,
} from "@opentelemetry/instrumentation";
import {
    ATTR_DB_COLLECTION_NAME,
    ATTR_DB_NAMESPACE,
    ATTR_DB_OPERATION_BATCH_SIZE,
    ATTR_DB_OPERATION_NAME,
    ATTR_DB_QUERY_SUMMARY,
    ATTR_DB_QUERY_TEXT,
    ATTR_DB_SYSTEM_NAME,
    ATTR_NETWORK_PROTOCOL_NAME,
    ATTR_SERVER_ADDRESS,
    ATTR_SERVER_PORT,
} from "@opentelemetry/semantic-conventions";
import * as surrealdbTypes from "surrealdb";
import { PACKAGE_NAME, PACKAGE_VERSION, SERVER_SYSTEM_NAME } from "./constants";
import { createDatabaseAttributeValue, createSummary, getProtocolName } from "./utils";

type SurrealMember = keyof typeof surrealdbTypes.Surreal.prototype;

const TRACKED_METHODS = [
    "authenticate",
    "create",
    "delete",
    "export",
    "health",
    "import",
    "insert",
    "invalidate",
    "query",
    "relate",
    "run",
    "select",
    "set",
    "signin",
    "signup",
    "unset",
    "update",
    "upsert",
    "use",
    "version",
] as const satisfies readonly SurrealMember[];

type TrackedMethod = (typeof TRACKED_METHODS)[number];

export class SurrealDBInstrumentation extends InstrumentationBase {
    constructor(config: InstrumentationConfig = {}) {
        super(PACKAGE_NAME, PACKAGE_VERSION, config);
    }

    protected override init() {
        return [
            new InstrumentationNodeModuleDefinition(
                SERVER_SYSTEM_NAME,
                [">=2.0.0"],
                (moduleExports: typeof surrealdbTypes) => {
                    if (moduleExports.Surreal) {
                        const proto = moduleExports.Surreal.prototype;

                        for (const method of TRACKED_METHODS) {
                            if (isWrapped(proto[method])) {
                                this._unwrap(proto, method);
                            }
                            this._wrap(proto, method, this._patchMethod(method));
                        }
                    }

                    return moduleExports;
                },
                (moduleExports: typeof surrealdbTypes) => {
                    if (moduleExports === undefined) {
                        return;
                    }

                    for (const method of TRACKED_METHODS) {
                        this._unwrap(moduleExports.Surreal.prototype, method);
                    }
                },
            ),
        ];
    }

    private _patchMethod(method: TrackedMethod) {
        const instrumentation = this;

        return (original: Function) => {
            return async function version(this: surrealdbTypes.Surreal, ...args: Parameters<any>) {
                return instrumentation._startActiveSpan(method, this, original, args);
            };
        };
    }

    private _startActiveSpan(
        method: TrackedMethod,
        instance: surrealdbTypes.Surreal,
        original: Function,
        args: unknown[],
    ) {
        let tableName: string | undefined;
        let functionName: string | undefined;

        if (
            method === "create" ||
            method === "delete" ||
            method === "insert" ||
            method === "select" ||
            method === "update" ||
            method === "upsert"
        ) {
            const arg0 = args[0] as Parameters<
                | typeof surrealdbTypes.Surreal.prototype.create
                | typeof surrealdbTypes.Surreal.prototype.delete
                | typeof surrealdbTypes.Surreal.prototype.insert
                | typeof surrealdbTypes.Surreal.prototype.select
                | typeof surrealdbTypes.Surreal.prototype.update
                | typeof surrealdbTypes.Surreal.prototype.upsert
            >[0];

            if (arg0 instanceof surrealdbTypes.Table) {
                tableName = arg0.name;
            }
            if (arg0 instanceof surrealdbTypes.RecordId) {
                tableName = arg0.table.name;
            }
            if (arg0 instanceof surrealdbTypes.RecordIdRange) {
                tableName = arg0.table.name;
            }
        }

        if (method === "run") {
            const arg0 = args[0] as Parameters<typeof surrealdbTypes.Surreal.prototype.run>[0];
            functionName = arg0;
        }

        const summary = createSummary(method, tableName || functionName);

        return this.tracer.startActiveSpan(summary, { kind: SpanKind.CLIENT }, async (span) => {
            try {
                span.setAttribute(ATTR_DB_SYSTEM_NAME, SERVER_SYSTEM_NAME);
                span.setAttribute(ATTR_DB_QUERY_SUMMARY, summary);
                span.setAttribute(ATTR_DB_OPERATION_NAME, method);
                span.setAttribute(
                    ATTR_DB_NAMESPACE,
                    createDatabaseAttributeValue(instance.namespace, instance.database),
                );

                if (tableName) {
                    span.setAttribute(ATTR_DB_COLLECTION_NAME, tableName);
                }

                if (instance.url) {
                    span.setAttribute(ATTR_SERVER_ADDRESS, instance.url.host);
                    span.setAttribute(ATTR_SERVER_PORT, instance.url.port);

                    const protocolName = getProtocolName(instance.url);
                    if (protocolName) {
                        span.setAttribute(ATTR_NETWORK_PROTOCOL_NAME, protocolName);
                    }
                }

                if (method === "query") {
                    const arg0 = args[0] as Parameters<
                        typeof surrealdbTypes.Surreal.prototype.query
                    >[0];

                    if (typeof arg0 === "string") {
                        span.setAttribute(ATTR_DB_QUERY_TEXT, arg0);
                    } else {
                        span.setAttribute(ATTR_DB_QUERY_TEXT, arg0.query);
                    }
                }

                const result = await original(...args);

                if (method === "query") {
                    const responses = result as Awaited<
                        ReturnType<typeof surrealdbTypes.Surreal.prototype.query>
                    >;
                    if (responses.length > 1) {
                        span.setAttribute(ATTR_DB_OPERATION_BATCH_SIZE, responses.length);
                    }
                }

                return result;
            } catch (err) {
                span.setStatus({
                    code: SpanStatusCode.ERROR,
                    message: (err as Error)?.message,
                });
                span.recordException(err as Error);
                throw err;
            } finally {
                span.end();
            }
        });
    }
}
