import { BlockReader, ShapedBlock, type ShapedCodec } from "@surrealdb/sqon";

/**
 * Turning the blocks of a decoded response into their rows.
 *
 * A block names its shapes by id, and those ids live in a scope wider than the one block: the
 * frames of one `query_stream` share a scope, so a shape announced in the first frame holds for
 * every later one, and the notifications of one live query share a scope for the life of the
 * subscription. A `query` response is its own scope, since nothing follows it.
 *
 * The codec therefore decodes tag 57 to a {@link ShapedBlock}, which still holds its bytes, and
 * the engine resolves it here once the envelope says which scope it belongs to.
 */

/** The scopes of one connection, keyed by the stream or live query whose shapes they hold */
export class ShapeScopes {
    #scopes = new Map<string, BlockReader>();

    /** The scope `key` names, started if this is the first block of it */
    get(key: string): BlockReader {
        let scope = this.#scopes.get(key);
        if (!scope) {
            scope = new BlockReader();
            this.#scopes.set(key, scope);
        }
        return scope;
    }

    /** Ends the scope `key` names: its stream finished, or its live query was killed */
    end(key: string): void {
        this.#scopes.delete(key);
    }

    /** Ends every scope, as a closed socket does */
    clear(): void {
        this.#scopes.clear();
    }
}

/**
 * `value` with every block in it replaced by its rows, read in `scope`.
 *
 * A block only ever reaches a value by having been decoded from tag 57, which this SDK refuses
 * on every format but `shaped`, so finding one anywhere in a response is the server having sent
 * one there; user data cannot imitate it. The walk therefore does not need to know which field
 * of which frame holds the block, only to leave everything else untouched — it descends through
 * arrays and plain objects alone, never into a value class such as a `RecordId`.
 */
export function resolveBlocks(value: unknown, codec: ShapedCodec, scope: BlockReader): unknown {
    if (value instanceof ShapedBlock) {
        return codec.rows(value, scope);
    }

    if (Array.isArray(value)) {
        let changed = false;
        const out = value.map((item) => {
            const resolved = resolveBlocks(item, codec, scope);
            if (resolved !== item) changed = true;
            return resolved;
        });
        return changed ? out : value;
    }

    if (
        typeof value === "object" &&
        value !== null &&
        Object.getPrototypeOf(value) === Object.prototype
    ) {
        let changed = false;
        const out: Record<string, unknown> = {};
        for (const [key, item] of Object.entries(value)) {
            const resolved = resolveBlocks(item, codec, scope);
            if (resolved !== item) changed = true;
            out[key] = resolved;
        }
        return changed ? out : value;
    }

    return value;
}
