/**
 * Recursively encode any supported SurrealQL value into a binary FlatBuffer representation
 *
 * @param data - The input value
 * @returns FlatBuffer binary representation
 */
export function encodeFlatBuffer<T>(_data: T): Uint8Array {
    throw new Error("Flat buffer encoding is not supported in this version");
}

/**
 * Decode a FlatBuffer encoded SurrealQL value into object representation
 *
 * @param data - The encoded SurrealQL value
 * @returns The parsed SurrealQL value
 */
export function decodeFlatBuffer<T>(_data: Uint8Array): T {
    throw new Error("Flat buffer decoding is not supported in this version");
}
