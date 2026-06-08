import { describe, expect, test } from "bun:test";
import {
    AuthError,
    errorFromResponse,
    NotFoundError,
    RateLimitError,
    ServerError,
    ValidationError,
} from "@surrealdb/spectron";

describe("errorFromResponse", () => {
    test("maps 401 to AuthError", () => {
        const h = new Headers();
        const err = errorFromResponse(401, { title: "Unauthorized", detail: "bad token" }, h);
        expect(err).toBeInstanceOf(AuthError);
        expect(err.status).toBe(401);
        expect(err.detail).toBe("bad token");
    });

    test("maps 404 to NotFoundError", () => {
        const err = errorFromResponse(404, { title: "Missing" }, new Headers());
        expect(err).toBeInstanceOf(NotFoundError);
    });

    test("maps 422 to ValidationError", () => {
        const err = errorFromResponse(422, { title: "Invalid" }, new Headers());
        expect(err).toBeInstanceOf(ValidationError);
    });

    test("maps 429 to RateLimitError with Retry-After", () => {
        const h = new Headers({ "Retry-After": "12" });
        const err = errorFromResponse(429, { title: "Slow down" }, h);
        expect(err).toBeInstanceOf(RateLimitError);
        expect((err as RateLimitError).retryAfter).toBe(12);
    });

    test("maps 500 to ServerError", () => {
        const err = errorFromResponse(500, { title: "oops" }, new Headers());
        expect(err).toBeInstanceOf(ServerError);
    });
});
