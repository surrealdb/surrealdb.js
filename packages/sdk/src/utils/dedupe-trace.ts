import type { QueryTrace } from "../types/trace";

/**
 * Removes the entries of a trace which repeat an earlier one, keeping the first of each.
 *
 * A streamed statement can report the same edge, reference or link on more than one frame, and a
 * trace which was collected from the frames of a statement holds each of them as often as it was
 * sent. Entries are told apart by their record ids, and a link also by its field. A variable is
 * told apart by its name, and a subscription by its id.
 *
 * @param trace The trace to deduplicate, which is not changed
 * @returns A trace holding each entry once
 */
export function dedupeTrace(trace: QueryTrace): QueryTrace {
    const unique = <T>(items: T[] | undefined, key: (item: T) => string): T[] | undefined => {
        if (!items) return undefined;

        const seen = new Set<string>();

        return items.filter((item) => {
            const id = key(item);
            if (seen.has(id)) return false;
            seen.add(id);
            return true;
        });
    };

    const deduped: QueryTrace = { ...trace };
    const relations = unique(
        trace.relations,
        (r) => `${r.in ?? ""}\u0000${r.edge}\u0000${r.out ?? ""}`,
    );
    const references = unique(trace.references, (r) => `${r.referrer}\u0000${r.referenced}`);
    const links = unique(trace.links, (l) => `${l.record}\u0000${l.field}\u0000${l.target}`);
    const subscriptions = unique(trace.subscriptions, (id) => String(id));

    if (relations) deduped.relations = relations;
    if (references) deduped.references = references;
    if (links) deduped.links = links;
    if (subscriptions) deduped.subscriptions = subscriptions;

    return deduped;
}
