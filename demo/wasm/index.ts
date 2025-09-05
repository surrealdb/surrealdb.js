import { createWasmEngines } from "@surrealdb/wasm";
import * as surrealdb from "surrealdb";
import { Surreal } from "surrealdb";

declare global {
    interface Window {
        surreal: Surreal;
        initialize: () => Promise<void>;
    }
}

if (typeof window !== "undefined") {
    Object.assign(window, surrealdb);

    window.surreal = new Surreal({
        engines: createWasmEngines(),
    });

    window.initialize = async () => {
        await window.surreal.connect("mem://");
        await window.surreal.use({
            namespace: "test",
            database: "test",
        });
    };

    console.log(
        "%cTip: %cUse the %cinitialize()%c function to connect and select a namespace and database",
        "color: #007bff; font-weight: bold",
        "",
        "color: #eee; font-weight: bold; font-family: monospace",
        "",
    );
}
