import { DateTime, StringRecordId, Uuid } from "../value";

/**
 * A template literal tag function for parsing a string type.
 *
 * @param string The string to parse
 * @param values The interpolated values
 * @returns The parsed string
 */
export function s(string: string[] | TemplateStringsArray, ...values: unknown[]): string {
    return string.reduce((prev, curr, i) => `${prev}${curr}${values[i] ?? ""}`, "");
}

/**
 * A template literal tag function for parsing a string into a Date.
 *
 * @param string The string to parse
 * @param values The interpolated values
 * @returns The parsed Date
 */
export function d(string: string[] | TemplateStringsArray, ...values: unknown[]): DateTime {
    return new DateTime(s(string, values));
}

/**
 * A template literal tag function for parsing a string into a StringRecordId.
 *
 * @param string The string to parse
 * @param values The interpolated values
 * @returns The parsed StringRecordId
 */
export function r(string: string[] | TemplateStringsArray, ...values: unknown[]): StringRecordId {
    return new StringRecordId(s(string, values));
}

/**
 * A template literal tag function for parsing a string into a Uuid.
 *
 * @param string The string to parse
 * @param values The interpolated values
 * @returns The parsed Uuid
 */
export function u(string: string[] | TemplateStringsArray, ...values: unknown[]): Uuid {
    return new Uuid(s(string, values));
}
