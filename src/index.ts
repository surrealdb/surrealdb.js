import { WebSocketStrategy } from "./strategies/websocket.ts";
import { HTTPStrategy } from "./strategies/http.ts";

export { WebSocketStrategy as Surreal, WebSocketStrategy as SurrealWebSocket };
export { HTTPStrategy as ExperimentalSurrealHTTP };
export default WebSocketStrategy;

export { PreparedQuery } from "./library/PreparedQuery.ts";
export { surrealql, surql } from "./library/tagged-template.ts";
