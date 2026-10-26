import { BlockReader, type ShapedCodec, type Uuid } from "@surrealdb/sqon";
import {
    ConnectionUnavailableError,
    MissingNamespaceDatabaseError,
    SurrealSqonError,
    UnexpectedServerResponseError,
    UnsupportedFeatureError,
} from "../errors";
import { throwIfAborted } from "../internal/abort";
import { buildRpcAuth } from "../internal/build-rpc-auth";
import {
    CBOR_MEDIA_TYPE,
    CBOR2_MEDIA_TYPE,
    cborCodec,
    isCbor2MediaType,
    isShapedMediaType,
    SHAPED_MEDIA_TYPE,
} from "../internal/cbor-format";
import { getSessionFromState } from "../internal/get-session-from-state";
import { fetchSurreal, readBody } from "../internal/http";
import { parseRpcError } from "../internal/parse-error";
import { resolveBlocks } from "../internal/shaped";
import { wrapSqonError } from "../internal/wrap-sqon-error";
import type {
    AnyAuth,
    AuthOrToken,
    MlExportOptions,
    RpcQueryResult,
    SqlExportOptions,
} from "../types";
import type { LiveMessage } from "../types/live";
import type { RpcRequest, RpcResponse } from "../types/rpc";
import type {
    ConnectionState,
    CredentialedRequestOptions,
    EngineEvents,
    QueryChunk,
    RequestOptions,
    Session,
    SurrealEngine,
} from "../types/surreal";
import type { BoundQuery } from "../utils";
import { Features } from "../utils";
import { Publisher } from "../utils/publisher";
import { RpcEngine } from "./rpc";

const ALWAYS_ALLOW = new Set([
    "use",
    "signin",
    "signup",
    "authenticate",
    "version",
    "query",
    "info",
]);

// Requests which establish the credentials of a session, or which do not need any. These
// never trigger the resolution of per-request credentials.
const NEVER_RESOLVE = new Set(["signin", "signup", "authenticate", "refresh", "revoke", "version"]);

interface SendOptions extends RequestOptions {
    /** Present this credential with the request, in place of the one of the session */
    credential?: AuthOrToken;
    /** Present no credential with the request, not even the one of the session */
    anonymous?: boolean;
}

/**
 * An engine that communicates by sending individual HTTP requests
 */
export class HttpEngine extends RpcEngine implements SurrealEngine {
    #publisher = new Publisher<EngineEvents>();

    /**
     * Whether the server has answered in `cbor.2`. Until it has, requests are written in plain
     * `cbor`, which every server reads, and ask for `cbor.2` back: a server before 4.0 answers in
     * `cbor`, and one which speaks `cbor.2` turns this on.
     */
    #cbor2 = false;

    /**
     * Whether an answer has shown that the server does not write `shaped`, after which it is no
     * longer asked for on this connection.
     */
    #shapedUnavailable = false;

    /**
     * Whether an answer has come back written in `shaped`, which is the only thing which shows
     * the server was built with the format and so reads a block in a request body.
     */
    #shapedConfirmed = false;

    features = new Set([
        Features.RefreshTokens,
        Features.Api,
        Features.ExportImportRaw,
        Features.SurrealML,
        Features.PerRequestAuth,
    ]);

    subscribe<K extends keyof EngineEvents>(
        event: K,
        listener: (...payload: EngineEvents[K]) => void,
    ): () => void {
        return this.#publisher.subscribe(event, listener);
    }

    open(state: ConnectionState): void {
        this._state = state;
        this.#cbor2 = false;
        this.#shapedUnavailable = false;
        this.#shapedConfirmed = false;
        setTimeout(() => {
            this.#publisher.publish("connected");
        });
    }

    async close(): Promise<void> {
        this._state = undefined;
        this.#publisher.publish("disconnected");
    }

    override health(): Promise<void> {
        return this.requestHealthEndpoint();
    }

    ready(version?: string): void {
        this._version = version;
    }

    /**
     * Run a query as someone else. The credential is presented with this request alone, and
     * the session is neither used for authentication nor changed.
     */
    async *queryAs<T>(
        query: BoundQuery,
        session: Session,
        txn: Uuid | undefined,
        options: CredentialedRequestOptions,
    ): AsyncIterable<QueryChunk<T>> {
        const responses: RpcQueryResult[] = await this.send(
            {
                method: options.dialect === "gql" ? "gql" : "query",
                params: [query.query, query.bindings],
                session,
                txn,
            },
            { signal: options.signal, credential: options.credential },
        );

        yield* this.toChunks<T>(responses);
    }

    /**
     * Import as someone else. As for a query, the credential is presented with this request alone,
     * and the connection is neither used for authentication nor changed.
     */
    async importSqlAs(
        data: string | Blob | ReadableStream,
        request: CredentialedRequestOptions,
    ): Promise<void> {
        await this.importWith(data, request, await this.#tokenFor(request));
    }

    /**
     * Export as someone else. See `importSqlAs()`.
     */
    async exportSqlAs(
        options: Partial<SqlExportOptions>,
        request: CredentialedRequestOptions,
    ): Promise<Response> {
        return this.exportWith(options, request, await this.#tokenFor(request));
    }

    /**
     * Export a model as someone else. See `importSqlAs()`.
     */
    async exportMlModelAs(
        options: MlExportOptions,
        request: CredentialedRequestOptions,
    ): Promise<Response> {
        return this.exportMlModelWith(options, request, await this.#tokenFor(request));
    }

    /**
     * The token which presents the credential of an import or export, for as long as it is wanted.
     */
    async #tokenFor(request: CredentialedRequestOptions): Promise<string> {
        const state = this._state;

        if (!state) {
            throw new ConnectionUnavailableError();
        }

        throwIfAborted(request.signal);

        return this.#present(request.credential, undefined, state, request.signal);
    }

    /**
     * The token which presents a credential: a token as it is, and authentication details
     * exchanged for one.
     */
    async #present(
        credential: AuthOrToken,
        session: Session,
        state: ConnectionState,
        signal: AbortSignal | undefined,
    ): Promise<string> {
        return typeof credential === "string"
            ? credential
            : this.#exchange(credential, session, state, signal);
    }

    /**
     * Exchange authentication details for a token, with nothing but the details to go on.
     */
    async #exchange(
        auth: AnyAuth,
        session: Session,
        state: ConnectionState,
        signal: AbortSignal | undefined,
    ): Promise<string> {
        const response = await this.send(
            {
                method: "signin",
                params: [buildRpcAuth(getSessionFromState(state, session), auth)],
                session,
            },
            { anonymous: true, signal },
        );

        return this.parseTokens(response).access;
    }

    override async send<Method extends string, Params extends unknown[] | undefined, Result>(
        request: RpcRequest<Method, Params>,
        options?: SendOptions,
    ): Promise<Result> {
        throwIfAborted(options?.signal);

        const state = this._state;

        if (!state) {
            throw new ConnectionUnavailableError();
        }

        // Unsupported by the HTTP protocol
        switch (request.method) {
            case "use":
            case "let":
            case "unset":
            case "reset":
            case "invalidate": {
                // if this is an empty use call, then that means we are
                // to try and retrieve a default namespace and database
                if (request.method === "use" && isEmptyUseParams(request.params)) {
                    break;
                }

                return undefined as unknown as Result;
            }
        }

        const session = getSessionFromState(state, request.session);

        if ((!session.namespace || !session.database) && !ALWAYS_ALLOW.has(request.method)) {
            throw new MissingNamespaceDatabaseError();
        }

        switch (request.method) {
            case "query":
            case "gql": {
                request.params = [
                    request.params?.[0],
                    {
                        ...session.variables,
                        ...(request.params?.[1] ?? {}),
                    },
                ] as Params;
                break;
            }
        }

        // The credential of a single request is neither stored nor sent in the body of the
        // request. Authentication details are exchanged for a token without touching the session,
        // and without presenting the credential of the session while doing so.
        let token: string | undefined;

        if (options?.anonymous) {
            token = "";
        } else if (options?.credential !== undefined) {
            token = await this.#present(options.credential, request.session, state, options.signal);
        }

        const id = this._context.uniqueId();
        const codecs = this._context.codecs;
        const res = await fetchSurreal(this._context, state, session, {
            body: {
                id,
                ...request,
            },
            // The server reads a block wherever a request holds a value, but only a build with
            // the format does, and nothing in a `cbor.2` answer says whether this one has it.
            // An answer which came back shaped does, so bodies are written as blocks only
            // after that; until then they are CBOR, which every server reads.
            codec:
                this.#shapedConfirmed && codecs.shaped
                    ? codecs.shaped
                    : cborCodec(codecs, this.#cbor2),
            headers: codecs.cbor2
                ? {
                      "Content-Type": this.#cbor2 ? CBOR2_MEDIA_TYPE : CBOR_MEDIA_TYPE,
                      // Only a server from 4.0 admits an Accept which differs from
                      // Content-Type, and only for these pairs; an earlier one answers 415.
                      // So shaped is asked for only once an answer in cbor.2 has shown the
                      // server to be 4.0, the same way cbor.2 is negotiated up from cbor.
                      Accept:
                          codecs.shaped && this.#cbor2 && !this.#shapedUnavailable
                              ? SHAPED_MEDIA_TYPE
                              : CBOR2_MEDIA_TYPE,
                  }
                : undefined,
            token,
            resolve: !NEVER_RESOLVE.has(request.method),
            signal: options?.signal,
        });

        const contentType = res.headers.get("Content-Type");
        const shaped = !!codecs.shaped && isShapedMediaType(contentType);
        const cbor2 = isCbor2MediaType(contentType);

        // A shaped answer is written in cbor.2, so a server which gives one speaks that too
        if ((cbor2 || shaped) && codecs.cbor2 && state === this._state) this.#cbor2 = true;

        // And a server which writes blocks is one built with the format, so it reads them too
        if (shaped && state === this._state) this.#shapedConfirmed = true;

        // A server built without the format answers a shaped Accept in plain cbor rather than
        // refusing it, which widens that answer's sized numbers. Nothing says so but the answer
        // itself, so the ask stops after the first one which comes back in neither format.
        if (!shaped && !cbor2 && codecs.shaped && this.#cbor2 && state === this._state) {
            this.#shapedUnavailable = true;
        }

        const buffer = await readBody(res, options?.signal);

        let response: RpcResponse<Result>;

        try {
            response = wrapSqonError(() => {
                const bytes = new Uint8Array(buffer);
                if (!shaped) {
                    return cborCodec(codecs, cbor2).decode<RpcResponse<Result>>(bytes);
                }

                // One HTTP response is one scope: nothing follows it which could name a shape
                // it announced.
                const codec = codecs.shaped as ShapedCodec;
                const decoded = codec.decode<RpcResponse<Result>>(bytes);
                return resolveBlocks(decoded, codec, new BlockReader()) as RpcResponse<Result>;
            });
        } catch (error) {
            if (error instanceof SurrealSqonError) {
                throw error;
            }

            throw new UnexpectedServerResponseError(error);
        }

        if (response.error) {
            throw parseRpcError(response.error);
        }

        return response.result;
    }

    override liveQuery(): AsyncIterable<LiveMessage> {
        throw new UnsupportedFeatureError(Features.LiveQueries);
    }
}

function isEmptyUseParams(params?: unknown[]): boolean {
    return (
        Array.isArray(params) &&
        typeof params[0] === "undefined" &&
        typeof params[1] === "undefined"
    );
}
