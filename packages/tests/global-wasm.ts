import { type Engines, Surreal } from "surrealdb";
import { createWasmEngines } from "../wasm/dist/surrealdb-wasm";

type GlobalThis = typeof globalThis & {
    embeddedEngines: Engines;
    surrealVersion?: string;
};

const engines = createWasmEngines();
(globalThis as GlobalThis).embeddedEngines = engines;

const surreal = new Surreal({ engines });
await surreal.connect("mem://");
const { version } = await surreal.version();
(globalThis as GlobalThis).surrealVersion = version;
await surreal.close();

import "./global";
