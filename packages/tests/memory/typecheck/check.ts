import type { components } from "@surrealdb/memory";
import { AgentMemory, type QueryMode } from "@surrealdb/memory";

type _Doc = components["schemas"]["DocumentJson"];
type _Mode = (typeof QueryMode)["vector"];

const _client = new AgentMemory({ endpoint: "https://api.test", context: "c", apiKey: "k" });
void (_client satisfies AgentMemory);
void (0 as unknown as _Doc);
void (0 as unknown as _Mode);
