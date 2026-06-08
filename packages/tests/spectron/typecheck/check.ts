import type { components } from "@surrealdb/spectron";
import { type QueryMode, Spectron } from "@surrealdb/spectron";

type _Doc = components["schemas"]["DocumentJson"];
type _Mode = (typeof QueryMode)["vector"];

const _client = new Spectron({ endpoint: "https://api.test", context: "c", apiKey: "k" });
void (_client satisfies Spectron);
void (0 as unknown as _Doc);
void (0 as unknown as _Mode);
