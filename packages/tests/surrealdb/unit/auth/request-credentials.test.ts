import { describe, expect, test } from "bun:test";
import { Uuid } from "../../../../sdk/src";
import {
    assertAuthCache,
    RequestCredentials,
} from "../../../../sdk/src/internal/request-credentials";
import { renewalDelay, tokenExpiry } from "../../../../sdk/src/internal/tokens";
import { createJwt, deferred } from "../__helpers__/mock-fetch";

const START = 1_800_000_000_000;

function setup(cache: ConstructorParameters<typeof RequestCredentials>[0]["cache"], margin = 60) {
    const clock = { now: START };
    const credentials = new RequestCredentials({
        cache,
        margin: () => margin,
        now: () => clock.now,
    });

    return { clock, credentials };
}

/** A JWT expiring `seconds` after the start of the test clock */
function expiring(seconds: number, id = "t") {
    return createJwt({ exp: START / 1000 + seconds, id });
}

describe("renewalDelay", () => {
    test("renews a margin before expiry", () => {
        expect(renewalDelay(3600, 60)).toBe(3540);
    });

    test("skips the margin for credentials which do not outlive it", () => {
        expect(renewalDelay(30, 60)).toBe(30);
        expect(renewalDelay(60, 60)).toBe(60);
    });

    test("never renews before the margin has passed", () => {
        expect(renewalDelay(100, 60)).toBe(60);
    });
});

describe("tokenExpiry", () => {
    test("reads the exp claim of a JWT", () => {
        expect(tokenExpiry(createJwt({ exp: 123 }))).toBe(123);
    });

    test("is undefined for tokens without a usable expiry", () => {
        expect(tokenExpiry("opaque")).toBeUndefined();
        expect(tokenExpiry(createJwt({ id: "no-exp" }))).toBeUndefined();
        expect(tokenExpiry(createJwt({ exp: "soon" }))).toBeUndefined();
    });
});

describe("assertAuthCache", () => {
    test("accepts the supported policies", () => {
        expect(() => assertAuthCache("until-expiry")).not.toThrow();
        expect(() => assertAuthCache("none")).not.toThrow();
        expect(() => assertAuthCache({ ttl: 30 })).not.toThrow();
    });

    test("rejects what cannot be honoured", () => {
        for (const cache of [{ ttl: 0 }, { ttl: -1 }, { ttl: Number.NaN }, "forever", {}, null]) {
            expect(() => assertAuthCache(cache as never)).toThrow();
        }
    });
});

describe("until-expiry", () => {
    test("reuses a token until a margin before it expires", async () => {
        const { clock, credentials } = setup("until-expiry", 60);
        let calls = 0;
        const load = async () => {
            calls++;
            return expiring(300, `n${calls}`);
        };

        const first = await credentials.get(undefined, load);
        expect(await credentials.get(undefined, load)).toBe(first);
        expect(calls).toBe(1);

        // 239s in: 61s of the token remain, more than the margin
        clock.now = START + 239_000;
        expect(await credentials.get(undefined, load)).toBe(first);
        expect(calls).toBe(1);

        // 241s in: 59s remain, which is within the margin
        clock.now = START + 241_000;
        expect(await credentials.get(undefined, load)).not.toBe(first);
        expect(calls).toBe(2);
    });

    test("does not reuse a token without an expiry", async () => {
        const { credentials } = setup("until-expiry");
        let calls = 0;
        const load = async () => `opaque-${++calls}`;

        expect(await credentials.get(undefined, load)).toBe("opaque-1");
        expect(await credentials.get(undefined, load)).toBe("opaque-2");
        expect(calls).toBe(2);
    });

    test("does not reuse a token which has expired", async () => {
        const { credentials } = setup("until-expiry");
        let calls = 0;
        const load = async () => {
            calls++;
            return expiring(-10, `n${calls}`);
        };

        await credentials.get(undefined, load);
        await credentials.get(undefined, load);
        expect(calls).toBe(2);
    });

    test("does not reuse the absence of credentials", async () => {
        const { credentials } = setup("until-expiry");
        let calls = 0;

        const load = async () => {
            calls++;
            return undefined;
        };

        await credentials.get(undefined, load);
        await credentials.get(undefined, load);
        expect(calls).toBe(2);
    });

    test("keeps sessions apart", async () => {
        const { credentials } = setup("until-expiry");
        const a = Uuid.v4();
        const b = Uuid.v4();

        const forA = await credentials.get(a, async () => expiring(300, "a"));
        const forB = await credentials.get(b, async () => expiring(300, "b"));
        const forDefault = await credentials.get(undefined, async () => expiring(300, "default"));

        expect(new Set([forA, forB, forDefault]).size).toBe(3);
        expect(await credentials.get(a, async () => "unused")).toBe(forA);
        expect(await credentials.get(b, async () => "unused")).toBe(forB);
        expect(await credentials.get(undefined, async () => "unused")).toBe(forDefault);
    });
});

describe("single flight", () => {
    test("concurrent requests share one resolution", async () => {
        const { credentials } = setup("until-expiry");
        const gate = deferred<string>();
        let calls = 0;
        const load = () => {
            calls++;
            return gate.promise;
        };

        const requests = [1, 2, 3, 4, 5].map(() => credentials.get(undefined, load));
        expect(calls).toBe(1);

        const token = expiring(300);
        gate.resolve(token);

        expect(await Promise.all(requests)).toEqual(Array(5).fill(token));
        expect(calls).toBe(1);
    });

    test("a failure is shared by the requests which waited, and then forgotten", async () => {
        const { credentials } = setup("until-expiry");
        const gate = deferred<string>();
        let calls = 0;
        const failing = () => {
            calls++;
            return gate.promise;
        };

        const waiting = [credentials.get(undefined, failing), credentials.get(undefined, failing)];
        const settled = Promise.allSettled(waiting);

        gate.reject(new Error("unavailable"));
        const results = await settled;

        expect(results.map((r) => r.status)).toEqual(["rejected", "rejected"]);
        expect(calls).toBe(1);

        // The next request tries again
        expect(
            await credentials.get(undefined, async () => expiring(300, "recovered")),
        ).toBeString();
    });

    test("the policy none shares nothing", async () => {
        const { credentials } = setup("none");
        const gate = deferred<string>();
        let calls = 0;
        const load = () => {
            calls++;
            return gate.promise;
        };

        const requests = [credentials.get(undefined, load), credentials.get(undefined, load)];
        expect(calls).toBe(2);

        gate.resolve("a");
        await Promise.all(requests);
    });
});

describe("none", () => {
    test("resolves for every request, however long the token lives", async () => {
        const { credentials } = setup("none");
        let calls = 0;
        const load = async () => {
            calls++;
            return expiring(3600);
        };

        await credentials.get(undefined, load);
        await credentials.get(undefined, load);
        await credentials.get(undefined, load);
        expect(calls).toBe(3);
    });
});

describe("ttl", () => {
    test("bounds the reuse of a token without an expiry", async () => {
        const { clock, credentials } = setup({ ttl: 30 });
        let calls = 0;
        const load = async () => `opaque-${++calls}`;

        expect(await credentials.get(undefined, load)).toBe("opaque-1");

        clock.now = START + 29_000;
        expect(await credentials.get(undefined, load)).toBe("opaque-1");

        clock.now = START + 31_000;
        expect(await credentials.get(undefined, load)).toBe("opaque-2");
    });

    test("never outlives the expiry of a token which has one", async () => {
        const { clock, credentials } = setup({ ttl: 3600 }, 60);
        let calls = 0;
        const load = async () => expiring(120, `n${++calls}`);

        const first = await credentials.get(undefined, load);

        // renewalDelay(120, 60) is 60s
        clock.now = START + 59_000;
        expect(await credentials.get(undefined, load)).toBe(first);

        clock.now = START + 61_000;
        expect(await credentials.get(undefined, load)).not.toBe(first);
    });

    test("is shorter than a long lived token", async () => {
        const { clock, credentials } = setup({ ttl: 10 }, 60);
        let calls = 0;
        const load = async () => expiring(3600, `n${++calls}`);

        await credentials.get(undefined, load);

        clock.now = START + 11_000;
        await credentials.get(undefined, load);
        expect(calls).toBe(2);
    });
});

describe("rejected tokens", () => {
    test("a rejected token is not handed out again", async () => {
        const { credentials } = setup("until-expiry");
        let calls = 0;
        const load = async () => expiring(300, `n${++calls}`);

        const first = await credentials.get(undefined, load);
        const second = await credentials.get(undefined, load, first);

        expect(second).not.toBe(first);
        expect(calls).toBe(2);

        // and the replacement is what is remembered
        expect(await credentials.get(undefined, load)).toBe(second);
        expect(calls).toBe(2);
    });

    test("a newer token is used rather than resolving again", async () => {
        const { credentials } = setup("until-expiry");
        let calls = 0;
        const load = async () => expiring(300, `n${++calls}`);

        const current = await credentials.get(undefined, load);

        // Another request already replaced the token this one was refused with
        expect(await credentials.get(undefined, load, "an-older-token")).toBe(current);
        expect(calls).toBe(1);
    });

    test("concurrent rejections share one new resolution", async () => {
        const { credentials } = setup("until-expiry");
        const gate = deferred<string>();
        let calls = 0;
        const stale = await credentials.get(undefined, async () => expiring(300, "stale"));
        const load = () => {
            calls++;
            return gate.promise;
        };

        const retries = [
            credentials.get(undefined, load, stale),
            credentials.get(undefined, load, stale),
            credentials.get(undefined, load, stale),
        ];

        gate.resolve(expiring(300, "fresh"));
        const tokens = await Promise.all(retries);

        expect(calls).toBe(1);
        expect(new Set(tokens).size).toBe(1);
        expect(tokens[0]).not.toBe(stale);
    });
});

describe("forgetting", () => {
    test("forget discards a session", async () => {
        const { credentials } = setup("until-expiry");
        let calls = 0;
        const load = async () => expiring(300, `n${++calls}`);

        await credentials.get(undefined, load);
        credentials.forget(undefined);
        await credentials.get(undefined, load);

        expect(calls).toBe(2);
    });

    test("forget leaves other sessions alone", async () => {
        const { credentials } = setup("until-expiry");
        const other = Uuid.v4();
        let calls = 0;
        const load = async () => expiring(300, `n${++calls}`);

        await credentials.get(other, load);
        credentials.forget(undefined);
        await credentials.get(other, load);

        expect(calls).toBe(1);
    });

    test("a resolution in flight when forgotten is not remembered", async () => {
        const { credentials } = setup("until-expiry");
        const gate = deferred<string>();
        let calls = 0;

        const inflight = credentials.get(undefined, () => {
            calls++;
            return gate.promise;
        });

        credentials.forget(undefined);
        gate.resolve(expiring(300, "late"));
        await inflight;

        await credentials.get(undefined, async () => expiring(300, "after"));
        expect(calls).toBe(1);

        // The later resolution is what is remembered, not the one which was forgotten
        const token = await credentials.get(undefined, async () => "unused");
        expect(token).toBe(expiring(300, "after"));
    });

    test("clear discards every session", async () => {
        const { credentials } = setup("until-expiry");
        const other = Uuid.v4();
        let calls = 0;
        const load = async () => expiring(300, `n${++calls}`);

        await credentials.get(other, load);
        await credentials.get(undefined, load);
        credentials.clear();
        await credentials.get(other, load);
        await credentials.get(undefined, load);

        expect(calls).toBe(4);
    });
});
