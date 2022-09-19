import Surreal from "../../mod.ts";
import handler from "./shared.js";

const client = new Surreal('http://127.0.0.1/rtc')

handler(client)