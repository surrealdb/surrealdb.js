import { createWasmWorkerEngines } from "@surrealdb/wasm";
import WorkerAgent from "@surrealdb/wasm/worker?worker";
import * as surrealdb from "surrealdb";
import { createRemoteEngines, Surreal } from "surrealdb";

declare global {
    interface Window {
        surreal: Surreal;
        initialize: () => Promise<void>;
    }
}

if (typeof window !== "undefined") {
    Object.assign(window, surrealdb);

    // The WebAssembly engines run in a Web Worker. Persistent browser stores
    // (surrealkv://) are only offered there, not on the main thread.
    window.surreal = new Surreal({
        codecOptions: {
            useNativeDates: true,
        },
        engines: {
            ...createWasmWorkerEngines({ createWorker: () => new WorkerAgent() }),
            ...createRemoteEngines(),
        },
    });

    window.initialize = async () => {
        // Use "surrealkv://demo" instead to keep the data between page loads.
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
