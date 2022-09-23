// %isomorphic-ws%
import Emitter from "./emitter.ts";

const OPENED = Symbol("Opened");
const CLOSED = Symbol("Closed");

export default class Socket extends Emitter<{
	"message": [MessageEvent<string>];
	"error": [Event];
	"close": [CloseEvent];
	"open": [Event];
}> {
	#ws!: WebSocket;

	#url: string;

	#closed = false;

	#status = CLOSED;

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
			this.emit("message", e);
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

		// If the WebSocket connection with the
		// database was disconnected, then we need
		// to reset the ready promise.

		this.#ws.addEventListener("close", () => {
			if (this.#status === OPENED) {
				this.#init();
			}
		});

		// When the WebSocket is opened or closed
		// then we need to store the connection
		// status within the status property.

		this.#ws.addEventListener("close", () => {
			this.#status = CLOSED;
		});

		this.#ws.addEventListener("open", () => {
			this.#status = OPENED;
		});

		// If the connection is closed, then we
		// need to attempt to reconnect on a
		// regular basis until we are successful.

		this.#ws.addEventListener("close", () => {
			if (this.#closed === false) {
				setTimeout(() => {
					this.open();
				}, 2500);
			}
		});

		// When the WebSocket successfully opens
		// then let's resolve the ready promise so
		// that promise based code can continue.

		this.#ws.addEventListener("open", () => {
			this.resolve();
		});
	}

	send(data: string): void {
		this.#ws.send(data);
	}

	close(code = 1000, reason = "Some reason"): void {
		this.#closed = true;
		this.#ws.close(code, reason);
	}
}
