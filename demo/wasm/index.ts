import { createWasmEngines } from "@surrealdb/wasm";
import * as surrealdb from "surrealdb";
import { Surreal } from "surrealdb";

declare global {
    interface Window {
        surreal: Surreal;
    }
}

if (typeof window !== "undefined") {
    Object.assign(window, surrealdb);

    window.surreal = new Surreal({
        engines: createWasmEngines(),
    });
}
