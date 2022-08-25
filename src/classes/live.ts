import Surreal from "..";
import { SurrealArgs } from "../utils/types";
import Emitter from "./emitter";

export default class Live extends Emitter {

    #id: string | undefined = undefined;
    #db: Surreal | undefined = undefined;
    #sql: string | undefined = undefined;
    #vars: SurrealArgs | undefined = undefined;

    constructor(db: Surreal, sql: string, vars: SurrealArgs) {
        super()

        this.#db = db;
        this.#sql = sql;
        this.#vars = vars;

        // TODO: Where does this come from?
        // if (this.#db.ready) {
        //     this.open();
        // }

        this.#db.on("opened", (e: any) => {
            this.open();
        });

        this.#db.on("closed", (e: any) => {
            this.#id = undefined;
        });

        this.#db.on("notify", (e: any) => {
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
    kill() {
        if (this.#id === undefined) return;

        let res = this.#db.kill(this.#id);
        this.#id = undefined;
        return res;
    }

    // If the live query has been manually
    // killed, then calling the open()
    // method will re-enable the query.
    open() {
        if (this.#id !== undefined) return;

        return this.#db.query(this.#sql, this.#vars).then((res: any) => {
            if (res[0] && res[0].result && res[0].result[0]) {
                this.#id = res[0].result[0];
            }
        });
    }

}
