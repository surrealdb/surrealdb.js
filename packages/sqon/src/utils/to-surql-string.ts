import {
    DateTime,
    Decimal,
    Duration,
    FileRef,
    Future,
    Geometry,
    Range,
    RecordId,
    SizedNumber,
    StringRecordId,
    Table,
    Uuid,
} from "../value/index.ts";

/**
 * Recursively convert any supported SurrealQL value into a string representation.
 *
 * @param input The input value
 * @returns Stringified SurrealQL representation
 */
export function toSurqlString(input: unknown): string {
    if (typeof input === "string") return `s${JSON.stringify(input)}`;
    if (input === null) return "NULL";
    if (input === undefined) return "NONE";

    if (typeof input === "object") {
        if (input instanceof Uuid) return `u${JSON.stringify(input.toString())}`;
        if (input instanceof Date || input instanceof DateTime)
            return `d${JSON.stringify(input.toISOString())}`;
        if (input instanceof RecordId || input instanceof StringRecordId)
            return `r${JSON.stringify(input.toString())}`;
        if (input instanceof FileRef) return `f${JSON.stringify(input.toString())}`;

        if (input instanceof Geometry) return toSurqlString(input.toJSON());

        if (input instanceof Decimal) return `${input.toJSON()}dec`;

        // SurrealDB 4.0's literals: 5u8, 1.5f32, and a cast for what has no literal
        if (input instanceof SizedNumber) {
            const value = input.value;
            if (typeof value === "number" && (!Number.isFinite(value) || Object.is(value, -0))) {
                return `<${input.kind}>${Object.is(value, -0) ? "-0.0" : value}`;
            }
            return `${value}${input.kind}`;
        }

        if (
            input instanceof Duration ||
            input instanceof Future ||
            input instanceof Range ||
            input instanceof Table
        ) {
            return input.toString();
        }

        switch (Object.getPrototypeOf(input)) {
            case Object.prototype: {
                let output = "{ ";
                const entries = Object.entries(input as object);
                for (const [i, [k, v]] of entries.entries()) {
                    output += `${JSON.stringify(k)}: ${toSurqlString(v)}`;
                    if (i < entries.length - 1) output += ", ";
                }
                output += " }";
                return output;
            }
            case Map.prototype: {
                let output = "{ ";
                const entries = Array.from((input as Map<unknown, unknown>).entries());
                for (const [i, [k, v]] of entries.entries()) {
                    output += `${JSON.stringify(k)}: ${toSurqlString(v)}`;
                    if (i < entries.length - 1) output += ", ";
                }
                output += " }";
                return output;
            }
            case Array.prototype: {
                const array = (input as unknown[]).map(toSurqlString);
                return `[ ${array.join(", ")} ]`;
            }
            case Set.prototype: {
                const set = [...(input as [])].map(toSurqlString);
                return `[ ${set.join(", ")} ]`;
            }
        }
    }

    return `${input}`;
}

export { toSurqlString as toSurrealqlString };
