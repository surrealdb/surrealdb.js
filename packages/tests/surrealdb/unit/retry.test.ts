import { describe, expect, test } from "bun:test";
import { isRetryableConflict as publicIsRetryableConflict } from "surrealdb";
import { QueryError, ThrownError, ValidationError } from "../../../sdk/src/errors";
import {
    DEFAULT_RETRY_OPTIONS,
    isRetryableConflict,
    RetryContext,
} from "../../../sdk/src/internal/retry";

test("isRetryableConflict is exported from the package root", () => {
    expect(typeof publicIsRetryableConflict).toBe("function");
});

describe("isRetryableConflict", () => {
    test("matches the structured transaction conflict detail", () => {
        expect(
            isRetryableConflict(
                new QueryError({
                    message: "Transaction conflict",
                    kind: "Query",
                    details: { kind: "TransactionConflict" },
                }),
            ),
        ).toBe(true);
    });

    test("ignores other structured query errors", () => {
        expect(
            isRetryableConflict(
                new QueryError({
                    message: "cancelled",
                    kind: "Query",
                    details: { kind: "Cancelled" },
                }),
            ),
        ).toBe(false);
    });

    test("does not match conflicts reported only via the message", () => {
        // The message is no longer inspected: only the structured detail counts.
        expect(
            isRetryableConflict(
                new ThrownError({
                    message:
                        "Failed to commit transaction due to a read or write conflict. This transaction can be retried",
                    kind: "Thrown",
                }),
            ),
        ).toBe(false);
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

describe("RetryContext.mergeOptions", () => {
    test("disabled by default", () => {
        expect(RetryContext.mergeOptions(undefined).enabled).toBe(false);
        expect(RetryContext.mergeOptions(undefined)).toBe(DEFAULT_RETRY_OPTIONS);
    });

    test("boolean input toggles enabled", () => {
        expect(RetryContext.mergeOptions(true).enabled).toBe(true);
        expect(RetryContext.mergeOptions(false).enabled).toBe(false);
    });

    test("object input opts in unless disabled explicitly", () => {
        const options = RetryContext.mergeOptions({ attempts: 3 });
        expect(options.enabled).toBe(true);
        expect(options.attempts).toBe(3);

        expect(RetryContext.mergeOptions({ enabled: false, attempts: 3 }).enabled).toBe(false);
    });

    test("layers over a provided base", () => {
        const base = { ...DEFAULT_RETRY_OPTIONS, retryDelay: 50, enabled: true };
        const options = RetryContext.mergeOptions({ attempts: 2 }, base);
        expect(options.retryDelay).toBe(50);
        expect(options.attempts).toBe(2);
        expect(options.enabled).toBe(true);
    });
});

describe("RetryContext", () => {
    test("reflects merged options", () => {
        const options = RetryContext.mergeOptions({ enabled: true, attempts: 3 });
        const ctx = new RetryContext(options);
        expect(ctx.enabled).toBe(true);
        expect(ctx.options.attempts).toBe(3);
    });

    test("allowed respects the attempt limit", async () => {
        const ctx = new RetryContext(
            RetryContext.mergeOptions({
                enabled: true,
                attempts: 2,
                retryDelay: 0,
                retryDelayMax: 0,
            }),
        );
        expect(ctx.allowed).toBe(true);
        await ctx.iterate();
        expect(ctx.attempts).toBe(1);
        expect(ctx.allowed).toBe(true);
        await ctx.iterate();
        expect(ctx.attempts).toBe(2);
        expect(ctx.allowed).toBe(false);
    });

    test("disabled context is never allowed", () => {
        expect(new RetryContext(RetryContext.mergeOptions(false)).allowed).toBe(false);
    });
});

describe("RetryContext.run", () => {
    const fast = RetryContext.mergeOptions({ enabled: true, retryDelay: 0, retryDelayMax: 0 });
    const conflict = () =>
        new QueryError({
            message: "Transaction conflict",
            kind: "Query",
            details: { kind: "TransactionConflict" },
        });

    test("runs once when retry is disabled", async () => {
        let calls = 0;
        await expect(
            new RetryContext(RetryContext.mergeOptions(false)).run(async () => {
                calls++;
                throw conflict();
            }),
        ).rejects.toBeInstanceOf(QueryError);
        expect(calls).toBe(1);
    });

    test("retries retryable errors until success", async () => {
        let calls = 0;
        const result = await new RetryContext(fast).run(async () => {
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
            new RetryContext(fast).run(async () => {
                calls++;
                throw new ValidationError({ message: "nope", kind: "Validation" });
            }),
        ).rejects.toBeInstanceOf(ValidationError);
        expect(calls).toBe(1);
    });

    test("rethrows after exhausting attempts", async () => {
        let calls = 0;
        await expect(
            new RetryContext(RetryContext.mergeOptions({ ...fast, attempts: 2 })).run(async () => {
                calls++;
                throw conflict();
            }),
        ).rejects.toBeInstanceOf(QueryError);
        expect(calls).toBe(3); // initial + 2 retries
    });

    test("honors a custom retryable predicate", async () => {
        let calls = 0;
        const result = await new RetryContext(
            RetryContext.mergeOptions({ ...fast, retryable: () => true }),
        ).run(async () => {
            calls++;
            if (calls < 2) throw new Error("anything");
            return "done";
        });
        expect(result).toBe("done");
        expect(calls).toBe(2);
    });
});
