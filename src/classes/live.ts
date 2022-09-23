import Surreal from "../index.ts";
import Emitter from "./emitter.ts";

export default class Live extends Emitter<{
	// deno-lint-ignore no-explicit-any
	"create": [any];
	// deno-lint-ignore no-explicit-any
	"update": [any];
	// deno-lint-ignore no-explicit-any
	"delete": [any];
}> {
	#id: string | undefined;

	#db: Surreal;

	#sql: string;

	#vars?: Record<string, unknown>;

	constructor(db: Surreal, sql: string, vars?: Record<string, unknown>) {
		super();

		this.#db = db;

		this.#sql = sql;

		this.#vars = vars;

		// @ts-expect-error ready was never set
		if (this.#db.ready) {
			this.open();
		}

		this.#db.on("opened", () => {
			this.open();
		});

		this.#db.on("closed", () => {
			this.#id = undefined;
		});

		this.#db.on("notify", (e) => {
			if (e.query === this.#id) {
				switch (e.action) {
					case "CREATE":
						return this.emit("create", e.result);
					case "UPDATE":
						return this.emit("update", e.result);
					case "DELETE":
						return this.emit("delete", e.result);
				}
			}
		});
	}

	// If we want to kill the live query
	// then we can kill it. Once a query
	// has been killed it can be opened
	// again by calling the open() method.

	kill(): void | Promise<void> {
		if (this.#id === undefined) return;

		const res = this.#db.kill(this.#id);

		this.#id = undefined;

		return res;
	}

	// If the live query has been manually
	// killed, then calling the open()
	// method will re-enable the query.

	open(): void | Promise<void> {
		if (this.#id !== undefined) return;

		return this.#db.query(this.#sql, this.#vars).then((res) => {
			if (res[0] && Array.isArray(res[0].result) && res[0].result[0]) {
				this.#id = res[0].result[0] as string;
			}
		});
	}
}
