import Surreal, { ExperimentalSurrealHTTP } from "../../src/index.ts";
import handler from "./shared.js";

const ws = new Surreal("http://127.0.0.1:8000/rpc");
const http = new ExperimentalSurrealHTTP("http://127.0.0.1:8000");

console.log("\n Testing Websocket");
await handler(ws);

console.log("\n Testing HTTP");
await handler(http);

ws.close();
http.close();
