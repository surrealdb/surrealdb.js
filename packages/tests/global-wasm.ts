import type { Engines } from "surrealdb";
import { createWasmEngines } from "../wasm/dist/surrealdb-wasm";

type GlobalThis = typeof globalThis & {
    embeddedEngines: Engines;
};

(globalThis as GlobalThis).embeddedEngines = createWasmEngines();

import "./global";