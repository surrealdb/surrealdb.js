import { SchemaValidationError } from "../errors";
import type { StandardSchemaV1 } from "../types";

/**
 * Check `value` against a Standard Schema, returning what the schema produced (which may differ
 * from the input when the schema transforms or coerces) or throwing a `SchemaValidationError`
 * listing every issue.
 */
export async function validateWith<S extends StandardSchemaV1>(
    schema: S,
    value: unknown,
    subject: string,
): Promise<StandardSchemaV1.InferOutput<S>> {
    const result = await schema["~standard"].validate(value);

    if (result.issues) {
        throw new SchemaValidationError(subject, result.issues);
    }

    return result.value;
}
