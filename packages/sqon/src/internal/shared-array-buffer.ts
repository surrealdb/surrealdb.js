/**
 * Checks whether a value is a `SharedArrayBuffer`.
 *
 * `SharedArrayBuffer` is not defined in every runtime SQON supports - it is absent on
 * Hermes / React Native, and in browsers which are not cross-origin-isolated - so a bare
 * `instanceof` throws a `ReferenceError` instead of evaluating to `false`.
 */
export function isSharedArrayBuffer(value: unknown): value is SharedArrayBuffer {
    return typeof SharedArrayBuffer !== "undefined" && value instanceof SharedArrayBuffer;
}
