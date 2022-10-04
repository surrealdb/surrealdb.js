import WebSocket from "../ws/deno.ts";
import Emitter from "./emitter.ts";

export interface EventLike {
	type: string;
}

export interface MessageEventLike<T> {
	type: string;
	data: T;
}

export interface CloseEventLike {
	wasClean: boolean;
	code: number;
	reason: string;
	type: string;
}

export enum ConnectionState {
	/**
	 * `.connect(...)` was not called
	 */
	NOT_CONNECTED,
	/**
	 * Connection closed by user
	 */
	CLOSED,
	/**
	 * Waiting on new connection
	 */
	RECONNECTING,
	/**
	 * Connection open
	 */
	OPEN,
}

export default class Socket extends Emitter<{
	"message": [MessageEventLike<string>];
	"error": [EventLike];
	"close": [CloseEventLike];
	"open": [EventLike];
}> {
	#ws!: WebSocket;

	#url: string;

	#closed = false;

	status = ConnectionState.RECONNECTING;

	constructor(url: URL | string) {
		super();

		this.#init();

		this.#url = String(url)
			.replace("http://", "ws://")
			.replace("https://", "wss://");
	}

	ready!: Promise<void>;
	private resolve!: () => void;

	#init(): void {
		this.ready = new Promise((resolve) => {
			this.resolve = resolve;
		});
	}

	open(): void {
		this.#ws = new WebSocket(this.#url);

		// Setup event listeners so that the
		// Surreal instance can listen to the
		// necessary event types.

		this.#ws.addEventListener("message", (e) => {
			this.emit("message", e as MessageEventLike<string>);
		});

		this.#ws.addEventListener("error", (e) => {
			this.emit("error", e);
		});

		this.#ws.addEventListener("close", (e) => {
			this.emit("close", e);
		});

		this.#ws.addEventListener("open", (e) => {
			this.emit("open", e);
		});

		this.#ws.addEventListener("close", () => {
			if (this.status === ConnectionState.OPEN) {
				// If the WebSocket connection with the
				// database was disconnected, then we need
				// to reset the ready promise.
				this.#init();
			}

			if (this.#closed === false) {
				// If the connection is closed, then we
				// need to attempt to reconnect on a
				// regular basis until we are successful.
				setTimeout(() => {
					this.open();
				}, 2500);

				// When the WebSocket is opened or closed
				// then we need to store the connection
				// status within the status property.
				this.status = ConnectionState.RECONNECTING;
			}
		});

		this.#ws.addEventListener("open", () => {
			this.status = ConnectionState.OPEN;
			// When the WebSocket successfully opens
			// then let's resolve the ready promise so
			// that promise based code can continue.
			this.resolve();
		});
	}

	send(data: string): void {
		this.#ws.send(data);
	}

	close(code = 1000, reason = "Some reason"): void {
		this.#closed = true;
		this.#ws.close(code, reason);
		this.status = ConnectionState.CLOSED;
	}
}
