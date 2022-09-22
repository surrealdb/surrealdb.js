import Surreal from "../../src/index.ts";
import handler from "./shared.js";

const client = new Surreal("http://127.0.0.1:8000/rpc");

await handler(client);

client.close();
