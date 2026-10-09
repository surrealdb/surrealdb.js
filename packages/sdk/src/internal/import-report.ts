import { HttpConnectionError, ImportError, type ServerError } from "../errors";
import { readChunks } from "./http";
import { parseQueryError, type RpcQueryResultErrRaw } from "./parse-error";

/** The most failures a report keeps, beyond which they are only counted */
const KEPT_FAILURES = 100;

/** How much of the start of a report is kept, to describe one which is not a list of results */
const HEAD_LENGTH = 1024;

const QUOTE = 34;
const BACKSLASH = 92;
const OPEN_SQUARE = 91;
const CLOSE_SQUARE = 93;
const OPEN_CURLY = 123;
const CLOSE_CURLY = 125;

export interface ImportReport {
    /** The statements which failed, up to the first hundred */
    failures: ServerError[];
    /** How many statements failed */
    failed: number;
    /** Whether the list ended before it was closed */
    truncated: boolean;
    /** The start of the report */
    head: string;
}

/**
 * Read the answer to an import, which lists the statements which failed, and reject with them.
 */
export async function readImportReport(
    response: Response,
    signal: AbortSignal | undefined,
): Promise<void> {
    const reader = new ImportReportReader();

    await readChunks(response, signal, (chunk) => reader.push(chunk));

    const { failures, failed, truncated, head } = reader.finish();

    if (failed > 0) {
        throw new ImportError(failures, failed, truncated);
    }

    if (response.status !== 200) {
        const buffer = new TextEncoder().encode(head).buffer as ArrayBuffer;
        throw new HttpConnectionError(head, response.status, response.statusText, buffer);
    }
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
            truncated: !this.#complete,
            head: this.#head,
        };
    }

    /** From 3.1 the list holds only failures, so those past the kept ones are counted unread */
    get #full(): boolean {
        return this.#failures.length >= KEPT_FAILURES;
    }

    #scan(text: string): void {
        if (this.#head.length < HEAD_LENGTH) {
            this.#head += text.slice(0, HEAD_LENGTH - this.#head.length);
        }

        let start = this.#depth >= 2 ? 0 : -1;
        let index = 0;

        while (index < text.length) {
            if (this.#inString) {
                index = this.#skipString(text, index);
                continue;
            }

            const code = text.charCodeAt(index);

            if (code === QUOTE) {
                this.#inString = true;
            } else if (code === OPEN_SQUARE || code === OPEN_CURLY) {
                if (++this.#depth === 2) start = index;
            } else if (code === CLOSE_SQUARE || code === CLOSE_CURLY) {
                if (--this.#depth === 1 && start !== -1) {
                    if (this.#full) this.#failed++;
                    else this.#take(this.#element + text.slice(start, index + 1));

                    this.#element = "";
                    start = -1;
                } else if (this.#depth === 0) {
                    this.#complete = true;
                }
            }

            index++;
        }

        if (start !== -1 && !this.#full) this.#element += text.slice(start);
    }

    /** Move past the rest of a string, to where the scan carries on */
    #skipString(text: string, from: number): number {
        let index = from;

        if (this.#escaped) {
            this.#escaped = false;
            index++;
        }

        for (;;) {
            const quote = text.indexOf('"', index);

            if (quote === -1) {
                this.#escaped = backslashesBefore(text, index, text.length) % 2 === 1;
                return text.length;
            }

            if (backslashesBefore(text, index, quote) % 2 === 0) {
                this.#inString = false;
                return quote + 1;
            }

            index = quote + 1;
        }
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
        this.#failures.push(parseQueryError(result as RpcQueryResultErrRaw));
    }
}

/** How many backslashes come right before `end`, looking no further back than `start` */
function backslashesBefore(text: string, start: number, end: number): number {
    let count = 0;

    while (end - count > start && text.charCodeAt(end - count - 1) === BACKSLASH) count++;

    return count;
}
