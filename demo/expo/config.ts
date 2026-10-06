import { Platform } from "react-native";
import type { RootAuth } from "surrealdb";

/**
 * Connection settings for the demo.
 *
 * This module has no runtime dependency on `surrealdb` - the only import is a type, which
 * is erased - so it can be read from anywhere without pulling in the SDK's module graph.
 *
 * `EXPO_PUBLIC_*` variables are inlined into the bundle by `babel-preset-expo` at build
 * time; they are not read from the environment at runtime. Changing one therefore requires
 * restarting Metro with a cleared cache:
 *
 *     EXPO_PUBLIC_SURREAL_URL=ws://192.168.1.20:8000 bun run demo:expo -- --clear
 */

/**
 * `localhost` is only correct in the iOS simulator, which shares the host machine's
 * loopback interface.
 *
 * - Android emulator: the host's loopback is reachable as `10.0.2.2`.
 * - Physical device (either platform): `localhost` is the phone itself, so you must use the
 *   host machine's LAN address. That cannot be guessed here - set `EXPO_PUBLIC_SURREAL_URL`.
 */
const DEFAULT_HOST = Platform.OS === "android" ? "10.0.2.2" : "localhost";

/** The SurrealDB RPC endpoint. `/rpc` is appended by the SDK's `parseEndpoint`. */
export const SURREAL_URL = process.env.EXPO_PUBLIC_SURREAL_URL ?? `ws://${DEFAULT_HOST}:8000`;

/** The namespace the demo writes to. */
export const SURREAL_NAMESPACE = process.env.EXPO_PUBLIC_SURREAL_NAMESPACE ?? "demo";

/** The database the demo writes to. */
export const SURREAL_DATABASE = process.env.EXPO_PUBLIC_SURREAL_DATABASE ?? "demo";

/** The table the demo upserts into and runs its live query against. */
export const DEMO_TABLE = "demo_items";

/**
 * Root credentials matching the `surreal start` command in the README.
 *
 * These are inlined into the JavaScript bundle, exactly like the URL above. That is fine
 * for a throwaway local demo and unacceptable for anything shipped: a real app
 * authenticates with a record access method (`db.signin({ access, variables })`) or a token
 * minted by your own backend, never with root credentials compiled into the client.
 */
export const SURREAL_CREDENTIALS: RootAuth = {
    username: process.env.EXPO_PUBLIC_SURREAL_USERNAME ?? "root",
    password: process.env.EXPO_PUBLIC_SURREAL_PASSWORD ?? "root",
};
