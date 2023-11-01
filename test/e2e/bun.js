import Surreal, { ExperimentalSurrealHTTP } from "../../npm/esm/index.js";
import * as exports from "../../npm/esm/index.js";
import handler from "./shared.js";
import fetch from 'node-fetch';

const ws = new Surreal();
const http = new ExperimentalSurrealHTTP({ fetch });

await ws.connect("http://127.0.0.1:8000");
await http.connect("http://127.0.0.1:8000");

console.log("\n Testing Websocket");
await handler(ws, exports);

console.log("\n Testing HTTP");
await handler(http, exports);

ws.close();
http.close();
