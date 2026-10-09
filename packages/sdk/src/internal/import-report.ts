import type { ServerError } from "../errors";
import { parseQueryError, type RpcQueryResultErrRaw } from "./parse-error";

/** The most failures a report keeps, beyond which they are only counted */
const KEPT_FAILURES = 100;

/** How much of the start of a report is kept, to describe one which is not a list of results */
const HEAD_LENGTH = 1024;

export interface ImportReport {
    /** The statements which failed, up to the first hundred */
    failures: ServerError[];
    /** How many statements failed */
    failed: number;
    /** Whether the list was read to its end */
    complete: boolean;
    /** The start of the report */
    head: string;
}

/**
 * Read the list of statement results an import is answered with as it arrives, holding no more
 * than one result at a time, however long the list is.
 */
export class ImportReportReader {
    #decoder = new TextDecoder();
    #depth = 0;
    #inString = false;
    #escaped = false;
    #element = "";
    #head = "";
    #complete = false;
    #failures: ServerError[] = [];
    #failed = 0;

    push(chunk: Uint8Array): void {
        this.#scan(this.#decoder.decode(chunk, { stream: true }));
    }

    finish(): ImportReport {
        this.#scan(this.#decoder.decode());

        return {
            failures: this.#failures,
            failed: this.#failed,
            complete: this.#complete,
            head: this.#head,
        };
    }

    #scan(text: string): void {
        if (this.#head.length < HEAD_LENGTH) {
            this.#head += text.slice(0, HEAD_LENGTH - this.#head.length);
        }

        let start = this.#depth >= 2 ? 0 : -1;

        for (let index = 0; index < text.length; index++) {
            const char = text[index];

            if (this.#inString) {
                if (this.#escaped) this.#escaped = false;
                else if (char === "\\") this.#escaped = true;
                else if (char === '"') this.#inString = false;
            } else if (char === '"') {
                this.#inString = true;
            } else if (char === "[" || char === "{") {
                if (++this.#depth === 2) start = index;
            } else if (char === "]" || char === "}") {
                if (--this.#depth === 1 && start !== -1) {
                    this.#take(this.#element + text.slice(start, index + 1));
                    this.#element = "";
                    start = -1;
                } else if (this.#depth === 0) {
                    this.#complete = true;
                }
            }
        }

        if (start !== -1) this.#element += text.slice(start);
    }

    #take(json: string): void {
        let result: Partial<RpcQueryResultErrRaw> | undefined;

        try {
            result = JSON.parse(json);
        } catch {
            return;
        }

        if (result?.status !== "ERR") return;

        this.#failed++;

        if (this.#failures.length < KEPT_FAILURES) {
            this.#failures.push(parseQueryError(result as RpcQueryResultErrRaw));
        }
    }
}
