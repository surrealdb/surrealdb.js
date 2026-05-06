import {
    DateTime,
    Decimal,
    Duration,
    FileRef,
    Future,
    Geometry,
    Range,
    RecordId,
    StringRecordId,
    Table,
    Uuid,
} from "../value";
import {
    isDateTime,
    isDecimal,
    isDuration,
    isFileRef,
    isFuture,
    isGeometry,
    isRange,
    isRecordId,
    isStringRecordId,
    isTable,
    isUuid,
} from "../utils/symbols";

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
        if (isUuid(input)) return `u${JSON.stringify((input as unknown as Uuid).toString())}`;
        if (input instanceof Date || isDateTime(input))
            return `d${JSON.stringify((input as unknown as DateTime).toISOString())}`;
        if (isRecordId(input) || isStringRecordId(input))
            return `r${JSON.stringify((input as unknown as RecordId | StringRecordId).toString())}`;
        if (isFileRef(input)) return `f${JSON.stringify((input as unknown as FileRef).toString())}`;

        if (isGeometry(input)) return toSurqlString((input as unknown as Geometry).toJSON());

        if (isDecimal(input)) return `${(input as unknown as Decimal).toJSON()}dec`;

        if (
            isDuration(input) ||
            isFuture(input) ||
            isRange(input) ||
            isTable(input)
        ) {
            return (input as unknown as { toJSON: () => string }).toJSON();
        }

        // We check by prototype, because we do not want to process derivatives of objects and arrays
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
