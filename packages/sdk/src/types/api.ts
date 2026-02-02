/**
 * Extendable interface for GET endpoint paths.
 * Use declaration merging to add your own paths.
 *
 * @example
 * ```ts
 * declare module 'surrealdb' {
 *     interface SurrealApiGetPaths {
 *         '/api/users': [void, User[]];
 *         '/api/users/:id': [void, User];
 *     }
 * }
 * ```
 */
// biome-ignore lint/suspicious/noEmptyInterface: Extendable by consumers via declaration merging
export interface SurrealApiGetPaths {}

/**
 * Extendable interface for POST endpoint paths.
 * Use declaration merging to add your own paths.
 *
 * @example
 * ```ts
 * declare module 'surrealdb' {
 *     interface SurrealApiPostPaths {
 *         '/create/user': [Signup, User];
 *     }
 * }
 * ```
 */
// biome-ignore lint/suspicious/noEmptyInterface: Extendable by consumers via declaration merging
export interface SurrealApiPostPaths {}

/**
 * Extendable interface for PUT endpoint paths.
 * Use declaration merging to add your own paths.
 *
 * @example
 * ```ts
 * declare module 'surrealdb' {
 *     interface SurrealApiPutPaths {
 *         '/update/user/:id': [User, User];
 *     }
 * }
 * ```
 */
// biome-ignore lint/suspicious/noEmptyInterface: Extendable by consumers via declaration merging
export interface SurrealApiPutPaths {}

/**
 * Extendable interface for DELETE endpoint paths.
 * Use declaration merging to add your own paths.
 *
 * @example
 * ```ts
 * declare module 'surrealdb' {
 *     interface SurrealApiDeletePaths {
 *         '/delete/user/:id': [];
 *     }
 * }
 * ```
 */
// biome-ignore lint/suspicious/noEmptyInterface: Extendable by consumers via declaration merging
export interface SurrealApiDeletePaths {}

/**
 * Extendable interface for PATCH endpoint paths.
 * Use declaration merging to add your own paths.
 *
 * @example
 * ```ts
 * declare module 'surrealdb' {
 *     interface SurrealApiPatchPaths {
 *         '/update/user/:id': [User, User];
 *     }
 * }
 * ```
 */
// biome-ignore lint/suspicious/noEmptyInterface: Extendable by consumers via declaration merging
export interface SurrealApiPatchPaths {}

/**
 * Extendable interface for TRACE endpoint paths.
 * Use declaration merging to add your own paths.
 *
 * @example
 * ```ts
 * declare module 'surrealdb' {
 *     interface SurrealApiTracePaths {
 *         '/trace/user/:id': [User, User];
 *     }
 * }
 * ```
 */
// biome-ignore lint/suspicious/noEmptyInterface: Extendable by consumers via declaration merging
export interface SurrealApiTracePaths {}
