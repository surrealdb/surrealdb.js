/**
 * Reading a `setTimeout` spy in a test which means "the SDK scheduled nothing".
 *
 * The WASM test run loads the embedded engine into the same process as the unit tests, and
 * its wasm-bindgen glue schedules a timer of its own - around a minute - to unref a callback.
 * That timer lands in whatever spy window happens to be open, so asserting on every delayed
 * `setTimeout` in the process tests the engine's bookkeeping as much as the SDK's.
 */

/** Whether `handler` is a callback wasm-bindgen scheduled, rather than one of ours */
function isWasmBindgenCallback(handler: unknown): boolean {
    return typeof handler === "function" && /_wbg_cb_unref|wbindgen/.test(String(handler));
}

/** The delays of the timers the SDK scheduled while the spy was installed */
export function sdkTimerDelays(spy: {
    mock: { calls: ReadonlyArray<readonly unknown[]> };
}): number[] {
    return spy.mock.calls
        .filter(
            ([handler, ms]) => typeof ms === "number" && ms > 0 && !isWasmBindgenCallback(handler),
        )
        .map(([, ms]) => ms as number);
}
