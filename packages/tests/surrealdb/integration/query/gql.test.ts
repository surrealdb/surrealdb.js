import { describe, expect, test } from "bun:test";
import { satisfies } from "semver";
import { createSurreal, requestVersion, SURREAL_BACKEND } from "../__helpers__";

const { version } = await requestVersion();

// ISO GQL (ISO/IEC 39075) is served by the WebSocket/HTTP RPC `gql` method from
// SurrealDB 3.2 onwards. The embedded (node/wasm) engines are built against a
// core that does not yet expose the GQL method, so the suite only runs against
// remote engines.
const hasGql =
    SURREAL_BACKEND === "remote" && satisfies(version, ">=3.2.0-0", { includePrerelease: true });

describe.if(hasGql)("gql", () => {
    test("match returns records", async () => {
        const surreal = await createSurreal();
        await surreal.query(
            "CREATE person:alice SET name = 'Alice', age = 30; CREATE person:bob SET name = 'Bob', age = 25;",
        );

        const [names] = await surreal.gql<[{ name: string }[]]>(
            "MATCH (p:person) RETURN p.name AS name ORDER BY name",
        );

        expect(names).toEqual([{ name: "Alice" }, { name: "Bob" }]);
    });

    test("match with bound variable", async () => {
        const surreal = await createSurreal();
        await surreal.query(
            "CREATE person:alice SET name = 'Alice', age = 30; CREATE person:bob SET name = 'Bob', age = 25;",
        );

        const [names] = await surreal.gql<[{ name: string }[]]>(
            "MATCH (p:person) WHERE p.age > $min RETURN p.name AS name ORDER BY name",
            { min: 26 },
        );

        expect(names).toEqual([{ name: "Alice" }]);
    });

    test("responses reports success", async () => {
        const surreal = await createSurreal();
        await surreal.query("CREATE person:alice SET name = 'Alice';");

        const [response] = await surreal.gql("MATCH (p:person) RETURN p.name AS name").responses();

        expect(response.success).toBe(true);
    });
});
