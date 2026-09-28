import type { components, LookupResponseJson, NeighbourhoodOptions } from "@surrealdb/memory";
import {
    AgentMemory,
    type EntityRanking,
    type LookupSection,
    type QueryMode,
} from "@surrealdb/memory";

type _Doc = components["schemas"]["DocumentJson"];
type _Mode = (typeof QueryMode)["vector"];
type _Ranking = (typeof EntityRanking)["coverage"];
type _Section = (typeof LookupSection)["passages"];

const _client = new AgentMemory({ endpoint: "https://api.test", context: "c", apiKey: "k" });
void (_client satisfies AgentMemory);
void (0 as unknown as _Doc);
void (0 as unknown as _Mode);
void (0 as unknown as _Ranking);
void (0 as unknown as _Section);

// `resolution` is a discriminated union on `kind`, so narrowing it reaches the
// arm's own fields rather than an optional-everything shape.
function _readSubject(response: LookupResponseJson): string | undefined {
    return response.resolution.kind === "entity"
        ? response.resolution.subject.entity.name
        : undefined;
}
void _readSubject;

// The neighbourhood walk refuses `count` beside `minFacts` at the type level,
// because the server rejects that pairing with a 400.
const _byCount: NeighbourhoodOptions = { count: true, limit: 10 };
const _byFacts: NeighbourhoodOptions = { minFacts: 2, cursor: "c" };
void _byCount;
void _byFacts;
