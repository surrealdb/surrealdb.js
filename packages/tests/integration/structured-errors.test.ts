import { describe, expect, test } from "bun:test";
import { satisfies } from "compare-versions";
import {
    AlreadyExistsError,
    type AnyAuth,
    NotAllowedError,
    ServerError,
    ThrownError,
    ValidationError,
} from "surrealdb";
import { createSurreal, requestVersion } from "./__helpers__";

const version = await requestVersion();
const structured = satisfies(version, ">=3.0.0");

describe.if(structured)("structured server errors", () => {
    // --------------------------------------------------------- //
    //  Invalid credentials -> NotAllowed + Auth details          //
    // --------------------------------------------------------- //

    test("invalid credentials", async () => {
        const surreal = await createSurreal();

        try {
            await surreal.signin({
                username: "invalid",
                password: "invalid",
            } as AnyAuth);
            expect.unreachable("Should have thrown");
        } catch (err) {
            expect(err).toBeInstanceOf(ServerError);
            expect(err).toBeInstanceOf(NotAllowedError);

            const e = err as NotAllowedError;
            expect(e.kind).toBe("NotAllowed");
            expect(e.code).toBe(-32002);
            expect(e.message).toBe("There was a problem with authentication");
            expect(e.details).toEqual({ kind: "Auth", details: { kind: "InvalidAuth" } });
            expect(e.isInvalidAuth).toBe(true);
            expect(e.isTokenExpired).toBe(false);
        }
    });

    // --------------------------------------------------------- //
    //  Invalid SurrealQL syntax -> Validation                    //
    // --------------------------------------------------------- //

    test("invalid syntax", async () => {
        const surreal = await createSurreal();

        try {
            await surreal.query("SEL ECT * FORM person");
            expect.unreachable("Should have thrown");
        } catch (err) {
            expect(err).toBeInstanceOf(ServerError);
            expect(err).toBeInstanceOf(ValidationError);

            const e = err as ValidationError;
            expect(e.kind).toBe("Validation");
            expect(e.code).toBe(-32000);
            expect(e.message).toBe(
                `Parse error: Unexpected token \`an identifier\`, expected Eof\n` +
                    ` --> [1:5]\n` +
                    `  |\n` +
                    `1 | SEL ECT * FORM person\n` +
                    `  |     ^^^\n`,
            );
        }
    });

    // --------------------------------------------------------- //
    //  Schema violation (type mismatch on field)                 //
    // --------------------------------------------------------- //

    test("schema violation", async () => {
        const surreal = await createSurreal();

        await surreal.query(`DEFINE FIELD age ON person TYPE int;`);

        const responses = await surreal
            .query(`CREATE person:1 SET age = "not a number"`)
            .responses();

        const res = responses[0];
        expect(res.success).toBe(false);

        if (!res.success) {
            const e = res.error;
            expect(e).toBeInstanceOf(ServerError);
            expect(e.kind).toBe("Internal");
            expect(e.code).toBe(0);
            expect(e.message).toBe(
                `Couldn't coerce value for field \`age\` of \`person:1\`: Expected \`int\` but found \`'not a number'\``,
            );
        }
    });

    // --------------------------------------------------------- //
    //  Non-existent function                                     //
    // --------------------------------------------------------- //

    test("non-existent function", async () => {
        const surreal = await createSurreal();

        const responses = await surreal.query("RETURN fn::does_not_exist()").responses();

        const res = responses[0];
        expect(res.success).toBe(false);

        if (!res.success) {
            const e = res.error;
            expect(e).toBeInstanceOf(ServerError);
            expect(e.kind).toBe("Internal");
            expect(e.code).toBe(0);
            expect(e.message).toBe(
                `Function 'fn::does_not_exist' not found: The function 'fn::does_not_exist' does not exist`,
            );
        }
    });

    // --------------------------------------------------------- //
    //  User THROW statement -> Thrown                            //
    // --------------------------------------------------------- //

    test("user throw", async () => {
        const surreal = await createSurreal();

        const responses = await surreal.query(`THROW "custom user error"`).responses();

        const res = responses[0];
        expect(res.success).toBe(false);

        if (!res.success) {
            const e = res.error;
            expect(e).toBeInstanceOf(ServerError);
            expect(e).toBeInstanceOf(ThrownError);
            expect(e.kind).toBe("Thrown");
            expect(e.code).toBe(0);
            expect(e.message).toBe("An error occurred: custom user error");
            expect(e.details).toBeUndefined();
        }
    });

    // --------------------------------------------------------- //
    //  Duplicate record -> AlreadyExists + Record details        //
    // --------------------------------------------------------- //

    test("duplicate record", async () => {
        const surreal = await createSurreal();

        await surreal.query(`CREATE person:dup SET name = "first"`);

        const responses = await surreal.query(`CREATE person:dup SET name = "second"`).responses();

        const res = responses[0];
        expect(res.success).toBe(false);

        if (!res.success) {
            const e = res.error;
            expect(e).toBeInstanceOf(ServerError);
            expect(e).toBeInstanceOf(AlreadyExistsError);
            expect(e.kind).toBe("AlreadyExists");
            expect(e.code).toBe(0);
            expect(e.message).toBe("Database record `person:dup` already exists");
            expect(e.details).toEqual({ kind: "Record", details: { id: "person:dup" } });

            const ae = e as AlreadyExistsError;
            expect(ae.recordId).toBe("person:dup");
            expect(ae.tableName).toBeUndefined();
        }
    });

    // --------------------------------------------------------- //
    //  .collect() throws ServerError directly                    //
    // --------------------------------------------------------- //

    test("collect throws ServerError", async () => {
        const surreal = await createSurreal();

        try {
            await surreal.query(`THROW "collect error"`).collect();
            expect.unreachable("Should have thrown");
        } catch (err) {
            expect(err).toBeInstanceOf(ServerError);
            expect(err).toBeInstanceOf(ThrownError);

            const e = err as ThrownError;
            expect(e.kind).toBe("Thrown");
            expect(e.code).toBe(0);
            expect(e.message).toBe("An error occurred: collect error");
        }
    });

    // --------------------------------------------------------- //
    //  Multi-statement: mix of success and failure               //
    // --------------------------------------------------------- //

    test("multi-statement responses", async () => {
        const surreal = await createSurreal();

        const responses = await surreal.query(`RETURN 1; THROW "fail"; RETURN 3`).responses();

        expect(responses).toHaveLength(3);

        // First statement succeeds
        expect(responses[0].success).toBe(true);
        if (responses[0].success) {
            expect(responses[0].result).toBe(1);
        }

        // Second statement fails with Thrown
        expect(responses[1].success).toBe(false);
        if (!responses[1].success) {
            const e = responses[1].error;
            expect(e).toBeInstanceOf(ThrownError);
            expect(e.kind).toBe("Thrown");
            expect(e.message).toBe("An error occurred: fail");
        }

        // Third statement still executes
        expect(responses[2].success).toBe(true);
        if (responses[2].success) {
            expect(responses[2].result).toBe(3);
        }
    });

    // --------------------------------------------------------- //
    //  Error frame via .stream()                                 //
    // --------------------------------------------------------- //

    test("stream yields error frames", async () => {
        const surreal = await createSurreal();

        const stream = surreal.query(`THROW "stream error"`).stream();
        let errorFound = false;

        for await (const frame of stream) {
            if (frame.isError()) {
                errorFound = true;
                expect(frame.error).toBeInstanceOf(ServerError);
                expect(frame.error).toBeInstanceOf(ThrownError);
                expect(frame.error.kind).toBe("Thrown");
                expect(frame.error.message).toBe("An error occurred: stream error");
            }
        }

        expect(errorFound).toBe(true);
    });
});
