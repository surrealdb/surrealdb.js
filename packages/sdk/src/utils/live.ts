import type { ConnectionController } from "../controller";
import { ConnectionUnavailable, SurrealError } from "../errors";
import type {
	LiveHandler,
	LivePayload,
	LiveResource,
	RpcResponse,
} from "../types";
import type { Uuid } from "../value";

/**
 * Represents a subscription to a LIVE SELECT query
 */
export abstract class LiveSubscription implements AsyncIterable<LivePayload> {
	/**
	 * The ID of the live subscription. Note that this id might change after
	 * a live query has been restarted.
	 */
	abstract get id(): Uuid;

	/**
	 * Returns whether this LiveQuery is managed by the driver and may be automatically
	 * restarted once the connection is re-established.
	 */
	abstract get isManaged(): boolean;

	/**
	 * The live resource that this subscription is tracking, if any.
	 */
	abstract get resource(): LiveResource | undefined;

	/**
	 * Whether the LiveQuery is considered alive. Although the connection may be
	 * disconnected, the LiveQuery may still be alive if it is managed by the driver.
	 */
	abstract get isAlive(): boolean;

	/**
	 * Subscribe to live updates and invoke the handler when an update is received
	 *
	 * @param handler The handler to invoke when an update is received
	 * @returns A function to unsubscribe from the live updates
	 */
	abstract subscribe(handler: LiveHandler): () => void;

	/**
	 * Kill the live subscription and stop receiving updates
	 */
	abstract kill(): Promise<RpcResponse<unknown>>;

	/**
	 * Iterate over the live subscription using an async iterator
	 */
	iterate(): AsyncIterator<LivePayload> {
		throw new Error("Not implemented");
	}

	[Symbol.asyncIterator](): AsyncIterator<LivePayload> {
		return this.iterate();
	}
}

/**
 * A managed live subscription that is automatically restarted when the connection
 * is re-established.
 */
export class ManagedLiveSubscription extends LiveSubscription {
	#currentId!: Uuid;
	#controller: ConnectionController;
	#resource: LiveResource;
	#diff: boolean;
	#killed = false;
	#cleanup: (() => void) | undefined;
	#reconnector: () => void;
	#listeners: Set<LiveHandler> = new Set();

	constructor(
		controller: ConnectionController,
		resource: LiveResource,
		diff: boolean,
	) {
		super();
		this.#controller = controller;
		this.#resource = resource;
		this.#diff = diff;

		this.#reconnector = this.#controller.subscribe("connected", () => {
			this.#listen();
		});

		if (this.#controller.status === "connected") {
			this.#listen();
		}
	}

	public get id(): Uuid {
		return this.#currentId;
	}

	public get isManaged(): boolean {
		return true;
	}

	public get resource(): LiveResource {
		return this.#resource;
	}

	public get isAlive(): boolean {
		return !this.#killed;
	}

	public subscribe(handler: LiveHandler): () => void {
		this.#listeners.add(handler);

		return () => {
			this.#listeners.delete(handler);
		};
	}

	public kill(): Promise<RpcResponse<unknown>> {
		this.#killed = true;
		this.#listeners.clear();
		this.#cleanup?.();
		this.#reconnector();

		return this.#controller.rpc({
			method: "kill",
			params: [this.#currentId],
		});
	}

	async #listen(): Promise<void> {
		this.#cleanup?.();

		const response: RpcResponse<Uuid> = await this.#controller.rpc({
			method: "live",
			params: [this.#resource, this.#diff],
		});

		if (response.error) {
			throw new SurrealError(
				`Failed to subscribe to live updates: ${response.error}`,
			);
		}

		this.#currentId = response.result;
		this.#cleanup = this.#controller.liveSubscribe(
			response.result,
			(action, result) => {
				for (const listener of this.#listeners) {
					listener(action, result);
				}
			},
		);
	}
}

/**
 * An unmanaged live subscription which is constructed with only
 * a known pre-existing ID. This subscription will not be automatically
 * restarted when the connection is re-established.
 */
export class UnmanagedLiveSubscription extends LiveSubscription {
	#id: Uuid;
	#controller: ConnectionController;
	#killed = false;
	#cleanup: () => void;
	#listeners: Set<LiveHandler> = new Set();

	constructor(controller: ConnectionController, id: Uuid) {
		super();
		this.#controller = controller;
		this.#id = id;

		if (this.#controller.status !== "connected") {
			throw new ConnectionUnavailable();
		}

		this.#cleanup = this.#controller.liveSubscribe(id, (action, result) => {
			for (const listener of this.#listeners) {
				listener(action, result);
			}
		});
	}

	public get id(): Uuid {
		return this.#id;
	}

	public get isManaged(): boolean {
		return false;
	}

	public get resource(): undefined {
		return undefined;
	}

	public get isAlive(): boolean {
		return !this.#killed;
	}

	public subscribe(handler: LiveHandler): () => void {
		this.#listeners.add(handler);

		return () => {
			this.#listeners.delete(handler);
		};
	}

	public kill(): Promise<RpcResponse<unknown>> {
		this.#killed = true;
		this.#listeners.clear();
		this.#cleanup();

		return this.#controller.rpc({
			method: "kill",
			params: [this.#id],
		});
	}
}
