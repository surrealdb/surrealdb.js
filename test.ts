import Surreal from "./mod.ts";

const surreal = new Surreal();
await surreal.connect('ws://0.0.0.0:8000/rpc');

await surreal.close();
