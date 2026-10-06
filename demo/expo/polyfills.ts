import { getRandomBytes } from "expo-crypto";

/**
 * Runtime shims required to run the `surrealdb` SDK on Hermes / React Native.
 *
 * Expo SDK 57 already installs `TextEncoder`, `TextDecoder`, the stream classes, a
 * spec-compliant `URL` / `URLSearchParams` (which matters - the SDK mutates `url.pathname`
 * in `parseEndpoint`), `structuredClone` and `fetch` on native. React Native itself
 * provides `WebSocket` and `Blob`. Everything installed below is what is left over.
 *
 * Every shim is behind a `typeof` guard, so each becomes a no-op as the underlying
 * runtimes improve. Call `installPolyfills()` once, as early as possible - see `index.ts`
 * for why it is an explicit call rather than a bare `import "./polyfills"` side effect.
 *
 * ---------------------------------------------------------------------------------------
 * Deliberately NOT polyfilled
 * ---------------------------------------------------------------------------------------
 *
 * `SharedArrayBuffer` - `packages/sqon/src/value/uuid.ts` used to perform a bare
 * `uuid instanceof SharedArrayBuffer`, which throws a `ReferenceError` on Hermes for
 * *every* `new Uuid(...)`: CBOR tag-9 decode, live query ids, session ids. It could not
 * have been fixed from here anyway, because `sqon` is bundled *inside* the `surrealdb`
 * dist bundle - there is no module boundary left to intercept. Defining a decoy
 * `globalThis.SharedArrayBuffer` would silence the crash (`x instanceof Decoy` is `false`,
 * which is the right answer) but would also make every `typeof SharedArrayBuffer !==
 * "undefined"` feature test in the bundle - and in every other library in the app - claim
 * shared memory is available. Fixed in the SDK instead, via `isSharedArrayBuffer()`.
 *
 * `CustomEvent` - the WebSocket engine used to report CBOR decode failures via
 * `socket.dispatchEvent(new CustomEvent("error", { detail }))`. A shim here would not have
 * helped: React Native's `WebSocket` extends the `event-target-shim` `EventTarget`, which
 * rejects foreign event objects, so the round trip fails even with `CustomEvent` defined.
 * Fixed in the SDK instead, by publishing the failure on the engine's own error channel.
 *
 * `Symbol.asyncDispose` - absent on Hermes, so the computed key in the SDK's session class
 * stringifies to `"undefined"` and the class grows a method literally named `undefined`
 * instead of a disposer. Nothing throws. It is not shimmed here because a shim would have
 * to be installed before the class body is evaluated, which means depending on bundler
 * module-evaluation order - the exact thing `index.ts` refuses to depend on. `App.tsx`
 * therefore uses an explicit `close()` and never `await using`.
 */

/** A single capability probed by {@link inspectRuntimeCapabilities}. */
export interface RuntimeCapability {
    /** Human-readable name of the capability. */
    name: string;
    /** Whether the capability is usable after `installPolyfills()` has run. */
    available: boolean;
    /** What breaks when it is missing. Rendered by the demo UI. */
    detail: string;
}

const BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** `expo-crypto`'s `getRandomBytes` throws a `TypeError` above this many bytes. */
const MAX_RANDOM_BYTES = 1024;

let installed = false;

/**
 * Install every shim the `surrealdb` SDK needs on Hermes. Idempotent, so it is safe to
 * call from more than one entry point.
 */
export function installPolyfills(): void {
    if (installed) return;
    installed = true;

    installGetRandomValues();
    installBase64();
    installDataViewBigInt();
}

/**
 * Probe the globals the SDK depends on, after shims have been installed.
 *
 * This exists because two of the gaps below degrade silently rather than crashing, and
 * because the `DataView` BigInt accessors are the least certain assumption in this demo.
 * Rendering the result in the UI is how you find out on a phone, where nobody reads the
 * console.
 */
export function inspectRuntimeCapabilities(): RuntimeCapability[] {
    return [
        {
            name: "crypto.getRandomValues",
            available: typeof globalThis.crypto?.getRandomValues === "function",
            detail: "Uuid.v4()/v7() silently degrade to Math.random()",
        },
        {
            name: "atob",
            available: typeof globalThis.atob === "function",
            detail: "JWT expiry is unreadable, so token renewal is never scheduled",
        },
        {
            name: "DataView 64-bit accessors",
            available: checkDataViewBigInt(),
            detail: "CBOR cannot encode or decode integers of 2^32 or more",
        },
        {
            name: "URL mutation",
            available: checkUrlMutation(),
            detail: "parseEndpoint() cannot append /rpc to the endpoint",
        },
        {
            name: "WebSocket",
            available: typeof globalThis.WebSocket === "function",
            detail: "the ws:// engine has no transport",
        },
    ];
}

/**
 * `crypto.getRandomValues` - absent on Hermes, and not provided by Expo either.
 *
 * Needed by the `uuidv7` dependency inlined into the SDK bundle, which backs `Uuid.v4()` /
 * `Uuid.v7()` and therefore the driver's session ids. `uuidv7` `typeof`-guards its access
 * and falls back to `Math.random()`, so this is not a crash - it is a silent correctness
 * and security defect, which is worse in a demo people copy from.
 *
 * Demo-local band-aid, not an SDK concern: supplying a CSPRNG is the host application's
 * job. (What the SDK could reasonably do is document the requirement, or fail loudly
 * rather than degrade silently.)
 *
 * `expo-crypto` is chosen over `react-native-get-random-values` because it ships inside
 * Expo Go, so `expo start` is enough and no `expo prebuild` / custom dev client is needed.
 *
 * The shim is built from `getRandomBytes()` rather than re-exporting `expo-crypto`'s own
 * `getRandomValues()` so that filling a non-`Uint8Array` view is unambiguously handled
 * here - `uuidv7` passes a `Uint32Array(8)`.
 */
function installGetRandomValues(): void {
    const existing: { getRandomValues?: unknown } | undefined = globalThis.crypto;

    if (typeof existing?.getRandomValues === "function") {
        return;
    }

    function getRandomValues<T extends ArrayBufferView>(view: T): T {
        const bytes = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);

        // `getRandomBytes` rejects requests above 1024 bytes, while the WebCrypto
        // contract allows up to 65536, so fill in chunks.
        for (let offset = 0; offset < bytes.length; offset += MAX_RANDOM_BYTES) {
            const size = Math.min(MAX_RANDOM_BYTES, bytes.length - offset);

            bytes.set(getRandomBytes(size), offset);
        }

        return view;
    }

    // `defineProperty` rather than plain assignment: some React Native versions install
    // `globalThis.crypto` as a non-writable property.
    if (existing) {
        Object.defineProperty(existing, "getRandomValues", {
            value: getRandomValues,
            configurable: true,
            writable: true,
        });

        return;
    }

    Object.defineProperty(globalThis, "crypto", {
        value: { getRandomValues },
        configurable: true,
        writable: true,
    });
}

/**
 * `atob` / `btoa` - availability on Hermes / React Native 0.86 is uncertain, so both are
 * installed behind a guard and then verified at runtime by
 * `inspectRuntimeCapabilities()`.
 *
 * `atob` is read by the SDK's `fastParseJwt` and by sqon's `fromBase64Url` (the
 * `JsonCodec` `$bytes` decode). `btoa` is read by the same sqon module when encoding bytes
 * with the JSON codec (unused on the CBOR path, installed for symmetry).
 *
 * Demo-local band-aid. A missing `atob` does *not* crash the auth path: `fastParseJwt`
 * swallows the `ReferenceError` and returns `null`, which makes the connection controller
 * skip scheduling a token renewal. `signin()` still succeeds and the session then dies
 * quietly when the access token expires - a failure mode that is close to undiagnosable on
 * a device, which is why this shim is here even though nothing throws without it.
 */
function installBase64(): void {
    if (typeof globalThis.atob !== "function") {
        Object.defineProperty(globalThis, "atob", {
            value: decodeBase64,
            configurable: true,
            writable: true,
        });
    }

    if (typeof globalThis.btoa !== "function") {
        Object.defineProperty(globalThis, "btoa", {
            value: encodeBase64,
            configurable: true,
            writable: true,
        });
    }
}

/**
 * `DataView.prototype.getBigUint64` / `setBigUint64` - UNVERIFIED on Hermes.
 *
 * Hermes has had BigInt for several releases, but whether these two `DataView` accessors
 * specifically are implemented in the Hermes shipped with React Native 0.86 is not
 * something this demo confirmed. Treat it as the first thing to check if CBOR fails.
 *
 * The inlined `@surrealdb/cbor` reaches them from `Writer.writeUint64` and
 * `Reader.readUint64`, which `writeMajor` selects for any length or integer of `2 ** 32`
 * or more. Concretely: putting `Date.now()` (~1.7e12) in a record payload is enough to hit
 * `setBigUint64` on the first write. The demo's own payload stays well below that on
 * purpose, and the accessors are probed directly by `inspectRuntimeCapabilities()`.
 *
 * Only the unsigned pair is shimmed, because those are the only two the CBOR codec uses.
 * Both branches handle either endianness even though the codec always requests big-endian.
 * The shim needs nothing but `BigInt` itself, which Hermes does have.
 */
function installDataViewBigInt(): void {
    if (typeof DataView === "undefined" || typeof BigInt !== "function") {
        return;
    }

    const proto = DataView.prototype;
    const shift = BigInt(32);
    const mask = BigInt("0xffffffff");

    if (typeof proto.getBigUint64 !== "function") {
        proto.getBigUint64 = function (this: DataView, byteOffset: number, little?: boolean) {
            const first = BigInt(this.getUint32(byteOffset, little));
            const second = BigInt(this.getUint32(byteOffset + 4, little));

            return little ? (second << shift) | first : (first << shift) | second;
        };
    }

    if (typeof proto.setBigUint64 !== "function") {
        proto.setBigUint64 = function (
            this: DataView,
            byteOffset: number,
            value: bigint,
            little?: boolean,
        ) {
            const low = Number(value & mask);
            const high = Number((value >> shift) & mask);

            this.setUint32(byteOffset + (little ? 0 : 4), low, little);
            this.setUint32(byteOffset + (little ? 4 : 0), high, little);
        };
    }
}

/** Round-trips the largest unsigned 64-bit value to exercise both halves. */
function checkDataViewBigInt(): boolean {
    try {
        const max = BigInt("18446744073709551615");
        const view = new DataView(new ArrayBuffer(8));

        view.setBigUint64(0, max, false);

        return view.getBigUint64(0, false) === max;
    } catch {
        return false;
    }
}

/** Exercises exactly what the SDK's `parseEndpoint` does to the endpoint URL. */
function checkUrlMutation(): boolean {
    try {
        const url = new URL("ws://127.0.0.1:8000");

        url.pathname = "/rpc";

        return url.toString() === "ws://127.0.0.1:8000/rpc";
    } catch {
        return false;
    }
}

/** Standard (not URL-safe) base64 decode, matching `atob` semantics. */
function decodeBase64(input: string): string {
    const data = String(input).replace(/[\t\n\f\r ]+/g, "");

    if (data.length % 4 === 1) {
        throw new Error("atob: the string to be decoded is not correctly encoded");
    }

    let output = "";
    let buffer = 0;
    let bits = 0;

    for (const character of data) {
        if (character === "=") break;

        const index = BASE64_ALPHABET.indexOf(character);

        if (index === -1) {
            throw new Error("atob: the string to be decoded contains invalid characters");
        }

        buffer = (buffer << 6) | index;
        bits += 6;

        if (bits >= 8) {
            bits -= 8;
            output += String.fromCharCode((buffer >> bits) & 0xff);
        }
    }

    return output;
}

/** Standard (not URL-safe) base64 encode, matching `btoa` semantics. */
function encodeBase64(input: string): string {
    const data = String(input);
    let output = "";

    for (let index = 0; index < data.length; index += 3) {
        const first = data.charCodeAt(index);
        const second = data.charCodeAt(index + 1);
        const third = data.charCodeAt(index + 2);

        if (first > 0xff || second > 0xff || third > 0xff) {
            throw new Error("btoa: the string contains characters outside of the Latin1 range");
        }

        const chunk =
            (first << 16) |
            ((Number.isNaN(second) ? 0 : second) << 8) |
            (Number.isNaN(third) ? 0 : third);

        output += BASE64_ALPHABET[(chunk >> 18) & 0x3f];
        output += BASE64_ALPHABET[(chunk >> 12) & 0x3f];
        output += Number.isNaN(second) ? "=" : BASE64_ALPHABET[(chunk >> 6) & 0x3f];
        output += Number.isNaN(third) ? "=" : BASE64_ALPHABET[chunk & 0x3f];
    }

    return output;
}
