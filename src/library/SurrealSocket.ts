import {
	WebsocketStatus,
	type RawSocketMessageResponse,
	type Result,
} from "../types.ts";
import WebSocket from "./WebSocket/deno.ts";
import { getIncrementalID } from "./getIncrementalID.ts";

export class SurrealSocket {
	private url: string;
	private onOpen?: () => unknown;
	private onClose?: () => unknown;
	private ws?: WebSocket;
	private status: WebsocketStatus = WebsocketStatus.CLOSED;
	private queue: Record<string, (data: Result) => unknown> = {};

	public ready: Promise<void>;
	private resolveReady: () => void;

	public socketClosureReason: Record<number, string> = {
		1000: "CLOSE_NORMAL",
	};

	constructor({
		url,
		onOpen,
		onClose,
	}: {
		url: URL;
		onOpen?: () => unknown;
		onClose?: () => unknown;
	}) {
		this.resolveReady = () => {}; // Purely for typescript typing :)
		this.ready = new Promise(r => this.resolveReady = r);

		this.url = "";
		this.onOpen = onOpen;
		this.onClose = onClose;
		this.setUrl(url);
	}

	open() {
		// Close any possibly connected sockets, reset status;
		this.close(1000);
		this.resetReady();

		// Connect to Surreal instance
		this.ws = new WebSocket(this.url);
		this.ws.addEventListener("open", (_e) => {
			this.status = WebsocketStatus.OPEN;
			this.resolveReady();
			this.onOpen?.();
		});

		this.ws.addEventListener("close", (_e) => {
			// Connection retry mechanism
			if (this.status !== WebsocketStatus.CLOSED) {
				this.status = WebsocketStatus.RECONNECTING;

				setTimeout(() => {
					this.open();
				}, 2500);

				this.onClose?.();
			}
		});

		this.ws.addEventListener("message", (e) => {
			const res = JSON.parse(
				e.data.toString()
			) as RawSocketMessageResponse;
			if (res.id && res.id in this.queue) {
				this.queue[res.id](res);
			}
		});
	}

	// Extracting the pure object to prevent any getters/setters that could break stuff
	// Prevent user from overwriting ID that is being sent
	async send(
		method: string,
		params: unknown[],
		callback: (data: Result) => unknown
	) {
		await this.ready;

		const id = getIncrementalID();
		this.queue[id] = callback;
		this.ws?.send(JSON.stringify({ id, method, params }));
	}

	close(reason: keyof typeof this.socketClosureReason) {
		this.status = WebsocketStatus.CLOSED;
		this.ws?.close(reason, this.socketClosureReason[reason]);
		this.onClose?.();
	}

	get connectionStatus() {
		return this.status;
	}

	private setUrl(url: URL) {
		if (url.protocol == "http:") url.protocol = "ws:";
		if (url.protocol == "https:") url.protocol = "wss:";
		this.url = `${url.origin}/rpc`;
	}

	private resetReady() {
		this.ready = new Promise((r) => (this.resolveReady = r));
	}
}