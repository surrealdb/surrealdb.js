import { GenericTables } from "./orm.ts";
import { infer as inferTableTypes } from './schema.ts';
import { RecordIdValue } from "../data/recordid.ts";

export type CacheValue<T extends GenericTables, Tb extends keyof T> = {
	document: inferTableTypes<T[Tb]>,
	expires: Date;
}
export type CacheListener<T extends GenericTables, Tb extends keyof T> = (payload: {
	tb: Tb,
	id: RecordIdValue,
	previous: CacheValue<T, Tb> | undefined,
	current: CacheValue<T, Tb>
}) => unknown;

export class ORMCache<T extends GenericTables> {
	// Default TTL is 5 minutes
	private readonly defaultTTL: number;

    private listeners: Set<CacheListener<T, keyof T>> = new Set();
    private listenersByTb: Partial<{
		[K in keyof T]: Set<CacheListener<T, K>>
	}> = {};
	private listenersById: Partial<{
		[K in keyof T]: Record<string, Set<CacheListener<T, K>>>
	}> = {}

	private cached: Partial<{
		[K in keyof T]: Record<string, CacheValue<T, K>>
	}> = {};

	constructor({
		defaultTTL
	}: {
		defaultTTL?: number
	} = {}) {
		this.defaultTTL = defaultTTL ?? 300000;
	}

    get<Tb extends keyof T>(
        tb: Tb,
		id: RecordIdValue
    ) {
        const cached = this.cached[tb]?.[JSON.stringify(id)];
		if (!cached) return;

		if (cached.expires.getTime() > new Date().getTime()) {
			this.invalidate(tb, id);
		} else {
			return cached.document;
		}
    }

    set<Tb extends keyof T>(tb: Tb, id: RecordIdValue, document: inferTableTypes<T[Tb]>, ttl?: number) {
		id = JSON.stringify(id);
		const previous = this.cached[tb]?.[id];
		const current = {
			expires: new Date(new Date().getTime() + (ttl ?? this.defaultTTL)),
			document
		};

		this.cached[tb] = {
			...(this.cached[tb] ?? {}),
			[id]: current
		};

        const listeners = [
            ...this.listeners,
            ...(this.listenersByTb[tb] ?? []),
            ...(this.listenersById[tb]?.[id] ?? []),
        ];

        listeners.forEach((l) => (l as CacheListener<T, Tb>)({
			tb,
			id,
			previous,
			current
		}));

        return true;
    }

    invalidate<Tb extends keyof T>(tb: Tb, id: RecordIdValue): true {
        delete this.cached[tb]?.[JSON.stringify(id)];
		return true;
    }

    subscribe<Tb extends keyof T = keyof T>(
        listener: CacheListener<T, Tb>,
        tb?: Tb,
		id?: RecordIdValue,
    ) {
		if (id) {
			if (!tb) throw new Error("Cannot subscribe to an id without specifying a table");
			id = JSON.stringify(id);

			const set = this.listenersById[tb]?.[id] || new Set();
			set.add(listener);

			this.listenersById[tb] = {
				...(this.listenersById[tb] ?? {}),
				[JSON.stringify(id)]: set,
			};
		} else if (tb) {
			const set = this.listenersByTb[tb] || new Set();
			set.add(listener);
			this.listenersByTb[tb] = set;
		} else {
			this.listeners.add(listener as CacheListener<T, keyof T>);
		}
    }

    unsubscribe<Tb extends keyof T = keyof T>(
        listener: CacheListener<T, Tb>,
        tb?: Tb,
		id?: RecordIdValue,
    ) {
		if (id) {
			if (!tb) throw new Error("Cannot unsubscribe from an id without specifying a table");
			id = JSON.stringify(id);
			this.listenersById[tb]?.[id].delete(listener);
		} else if (tb) {
			this.listenersByTb[tb]?.delete(listener);
		} else {
			this.listeners.delete(listener as CacheListener<T, keyof T>);
		}
    }
}
