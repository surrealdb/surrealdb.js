import { afterAll, afterEach, beforeAll, beforeEach } from "bun:test";
import { escapeIdent } from "surrealdb";
import { resetIncrementalID } from "../sdk/src/internal/get-incremental-id";
import { SURREAL_DB, SURREAL_NS } from "./integration/__helpers__/env";
import {
    connections,
    createSurreal,
    killServer,
    spawnServer,
} from "./integration/__helpers__/surreal";

beforeAll(async () => {
    await spawnServer();
});

afterAll(async () => {
    await killServer();
});

beforeEach(async () => {
    const surreal = await createSurreal();

    await surreal.query(`
		REMOVE NS IF EXISTS ${escapeIdent(SURREAL_NS)};
		REMOVE DB IF EXISTS ${escapeIdent(SURREAL_DB)};
		DEFINE NS ${escapeIdent(SURREAL_NS)};
		DEFINE DB ${escapeIdent(SURREAL_DB)};
	`);

    await surreal.close();

    resetIncrementalID();
});

afterEach(async () => {
    for (const connection of connections) {
        await connection.close();
    }
});
