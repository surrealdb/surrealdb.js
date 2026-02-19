import type { Engines } from "surrealdb";
import { createNodeEngines } from "../node/dist/surrealdb-node";

type GlobalThis = typeof globalThis & {
    embeddedEngines: Engines;
};

(globalThis as GlobalThis).embeddedEngines = createNodeEngines();

import "./global";
