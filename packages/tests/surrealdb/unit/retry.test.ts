import { describe, expect, test } from "bun:test";
import { isRetryableConflict as publicIsRetryableConflict } from "surrealdb";
import { ThrownError, ValidationError } from "../../../sdk/src/errors";
import {
    DEFAULT_RETRY_OPTIONS,
    isRetryableConflict,
    RetryContext,
    withRetry,
} from "../../../sdk/src/internal/retry";

test("isRetryableConflict is exported from the package root", () => {
    expect(typeof publicIsRetryableConflict).toBe("function");
});

describe("isRetryableConflict", () => {
    test("matches conflict server errors", () => {
        expect(
            isRetryableConflict(
                new ThrownError({
                    message:
                        "Failed to commit transaction due to a read or write conflict. This transaction can be retried",
                    kind: "Thrown",
                }),
            ),
        ).toBe(true);

        expect(
            isRetryableConflict(new ThrownError({ message: "CONFLICT detected", kind: "Thrown" })),
        ).toBe(true);
    });

    test("ignores unrelated server errors", () => {
        expect(
            isRetryableConflict(
                new ValidationError({ message: "parse error", kind: "Validation" }),
            ),
        ).toBe(false);
    });

    test("ignores non-server errors", () => {
        expect(isRetryableConflict(new Error("conflict"))).toBe(false);
        expect(isRetryableConflict("conflict")).toBe(false);
        expect(isRetryableConflict(undefined)).toBe(false);
    });
});

describe("RetryContext", () => {
    test("disabled by default", () => {
        expect(new RetryContext(undefined).enabled).toBe(false);
        expect(new RetryContext(undefined).options).toBe(DEFAULT_RETRY_OPTIONS);
    });

    test("boolean input toggles enabled", () => {
        expect(new RetryContext(true).enabled).toBe(true);
        expect(new RetryContext(false).enabled).toBe(false);
    });

    test("object input opts in unless disabled explicitly", () => {
        const ctx = new RetryContext({ attempts: 3 });
        expect(ctx.enabled).toBe(true);
        expect(ctx.options.attempts).toBe(3);

        expect(new RetryContext({ enabled: false, attempts: 3 }).enabled).toBe(false);
    });

    test("layers over a provided base", () => {
        const base = { ...DEFAULT_RETRY_OPTIONS, retryDelay: 50, enabled: true };
        const ctx = new RetryContext({ attempts: 2 }, base);
        expect(ctx.options.retryDelay).toBe(50);
        expect(ctx.options.attempts).toBe(2);
        expect(ctx.enabled).toBe(true);
    });

    test("allowed respects the attempt limit", async () => {
        const ctx = new RetryContext({
            enabled: true,
            attempts: 2,
            retryDelay: 0,
            retryDelayMax: 0,
        });
        expect(ctx.allowed).toBe(true);
        await ctx.iterate();
        expect(ctx.attempts).toBe(1);
        expect(ctx.allowed).toBe(true);
        await ctx.iterate();
        expect(ctx.attempts).toBe(2);
        expect(ctx.allowed).toBe(false);
    });

    test("disabled context is never allowed", () => {
        expect(new RetryContext(false).allowed).toBe(false);
    });
});

describe("withRetry", () => {
    const fast = { enabled: true, retryDelay: 0, retryDelayMax: 0 };
    const conflict = () =>
        new ThrownError({ message: "read or write conflict, can be retried", kind: "Thrown" });

    test("runs once when retry is disabled", async () => {
        let calls = 0;
        await expect(
            withRetry(new RetryContext(false), async () => {
                calls++;
                throw conflict();
            }),
        ).rejects.toBeInstanceOf(ThrownError);
        expect(calls).toBe(1);
    });

    test("retries retryable errors until success", async () => {
        let calls = 0;
        const result = await withRetry(new RetryContext(fast), async () => {
            calls++;
            if (calls < 3) throw conflict();
            return "ok";
        });
        expect(result).toBe("ok");
        expect(calls).toBe(3);
    });

    test("does not retry non-retryable errors", async () => {
        let calls = 0;
        await expect(
            withRetry(new RetryContext(fast), async () => {
                calls++;
                throw new ValidationError({ message: "nope", kind: "Validation" });
            }),
        ).rejects.toBeInstanceOf(ValidationError);
        expect(calls).toBe(1);
    });

    test("rethrows after exhausting attempts and fires onRetry", async () => {
        let calls = 0;
        let retries = 0;
        await expect(
            withRetry(
                new RetryContext({ ...fast, attempts: 2 }),
                async () => {
                    calls++;
                    throw conflict();
                },
                () => {
                    retries++;
                },
            ),
        ).rejects.toBeInstanceOf(ThrownError);
        expect(calls).toBe(3); // initial + 2 retries
        expect(retries).toBe(2);
    });

    test("honors a custom retryable predicate", async () => {
        let calls = 0;
        const result = await withRetry(
            new RetryContext({ ...fast, retryable: () => true }),
            async () => {
                calls++;
                if (calls < 2) throw new Error("anything");
                return "done";
            },
        );
        expect(result).toBe("done");
        expect(calls).toBe(2);
    });
});
