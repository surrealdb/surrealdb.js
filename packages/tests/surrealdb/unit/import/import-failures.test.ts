import { afterEach, describe, expect, test } from "bun:test";
import { AlreadyExistsError, HttpConnectionError, ImportError } from "surrealdb";
import {
    closeTransfers,
    connect,
    connectInBrowser,
    installXhr,
    received,
} from "../__helpers__/transfer";

afterEach(closeTransfers);

const duplicate = {
    status: "ERR",
    time: "1µs",
    result: "Database record `a:1` already exists",
    kind: "AlreadyExists",
    details: { kind: "Record", details: { id: "a:1" } },
};

const report = (count: number) => JSON.stringify(new Array(count).fill(duplicate));

async function caught(promise: PromiseLike<unknown>): Promise<unknown> {
    try {
        await promise;
    } catch (error) {
        return error;
    }

    throw new Error("Expected the import to fail");
}

/** A server answering an import, after reading all of it, with the given status and body */
function answering(status: number, body: string, log: { cancelled?: boolean } = {}) {
    const encoder = new TextEncoder();

    return async (init: RequestInit) => {
        await received(init.body);

        return new Response(
            new ReadableStream({
                start(controller) {
                    controller.enqueue(encoder.encode(body));
                    controller.close();
                },
                cancel() {
                    log.cancelled = true;
                },
            }),
            { status },
        );
    };
}

describe("an import into SurrealDB 3.1 or later", () => {
    const server = { version: "3.2.3" };

    test("which applied in full resolves", async () => {
        const { db } = await connect(answering(200, "[]"), server);

        await db.import("OPTION IMPORT; CREATE a:1;");
    });

    test("whose statements failed, answered with a 200, rejects with them", async () => {
        const { db } = await connect(answering(200, report(3)), server);

        const error = (await caught(db.import("OPTION IMPORT;"))) as ImportError;

        expect(error).toBeInstanceOf(ImportError);
        expect(error.failed).toBe(3);
        expect(error.truncated).toBe(false);
        expect(error.failures[0]).toBeInstanceOf(AlreadyExistsError);
        expect(error.cause).toBe(error.failures[0]);
        expect(error.message).toBe(
            "3 statements of the import failed. The first failed with: Database record `a:1` already exists",
        );
    });

    test("whose statements failed, answered with a 422, rejects with them", async () => {
        const { db } = await connect(answering(422, report(1)), { version: "3.4.0-nightly" });

        const error = (await caught(db.import("OPTION IMPORT;"))) as ImportError;

        expect(error).toBeInstanceOf(ImportError);
        expect(error.message).toBe(
            "1 statement of the import failed. The first failed with: Database record `a:1` already exists",
        );
    });

    test("answered with a 422 which lists nothing rejects with the answer", async () => {
        const { db } = await connect(answering(422, "Unprocessable"), server);

        const error = (await caught(db.import("OPTION IMPORT;"))) as HttpConnectionError;

        expect(error).toBeInstanceOf(HttpConnectionError);
        expect(error.status).toBe(422);
        expect(error.message).toContain("Unprocessable");
    });

    test("which the server refuses still fails as before", async () => {
        const { db } = await connect(answering(400, "Import requires `OPTION IMPORT;`"), server);

        const error = (await caught(db.import("CREATE a:1;"))) as HttpConnectionError;

        expect(error).toBeInstanceOf(HttpConnectionError);
        expect(error.status).toBe(400);
    });
});

describe("an import into an older SurrealDB", () => {
    test("leaves the answer unread, which lists every statement, as it always has", async () => {
        const log: { cancelled?: boolean } = {};
        const { db } = await connect(answering(200, report(2), log), { version: "3.0.4" });

        await db.import("CREATE a:1; CREATE a:1;");

        expect(log.cancelled).toBe(true);
    });

    test("2.x is not read either", async () => {
        const { db } = await connect(answering(200, report(2)), { version: "2.3.10" });

        await db.import("CREATE a:1; CREATE a:1;");
    });
});

describe("an import with progress in a browser", () => {
    test("takes the report as a Blob, and reads every failure from it", async () => {
        const requests = installXhr({ body: report(20_000) });
        const { db } = await connectInBrowser({ version: "3.2.3" });

        const error = (await caught(db.import("OPTION IMPORT;").progress(() => {}))) as ImportError;

        expect(error).toBeInstanceOf(ImportError);
        expect(error.failed).toBe(20_000);
        expect(error.truncated).toBe(false);
        expect(error.failures).toHaveLength(100);
        expect(error.message.startsWith("20000 statements of the import failed.")).toBe(true);
        expect(requests[0]?.aborted).toBe(false);
    });

    test("which applied in full resolves, having downloaded only the empty list", async () => {
        const requests = installXhr({ body: "[]" });
        const { db } = await connectInBrowser({ version: "3.2.3" });

        await db.import("OPTION IMPORT;").progress(() => {});

        expect(requests[0]?.downloaded).toBe(2);
    });

    test("into an older server does not download the answer", async () => {
        const requests = installXhr({ body: report(10) });
        const { db } = await connectInBrowser({ version: "3.0.4" });

        await db.import("OPTION IMPORT;").progress(() => {});

        expect(requests[0]?.aborted).toBe(true);
        expect(requests[0]?.downloaded).toBe(0);
    });
});
