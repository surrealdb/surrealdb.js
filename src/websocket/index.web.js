if (typeof WebSocket !== "undefined") {
	module.exports = WebSocket;
} else if (typeof window !== "undefined") {
	module.exports = window.WebSocket;
} else if (typeof FastBoot !== "undefined") {
	module.exports = FastBoot.require("ws");
}
