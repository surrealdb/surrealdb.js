import Surreal from "../..";
import handler from "./shared.js";

const client = new Surreal('http://127.0.0.1/rtc')

await handler(client)

client.close()