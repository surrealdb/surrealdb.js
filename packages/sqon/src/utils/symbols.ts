/**
 * Symbol-based type checking utilities for handling multiple library instances.
 * This allows instanceof-like checks to work across different instances/versions of the library.
 */

const VALUE_SYMBOL = Symbol.for("surrealdb.Value");
const RECORD_ID_SYMBOL = Symbol.for("surrealdb.RecordId");
const STRING_RECORD_ID_SYMBOL = Symbol.for("surrealdb.StringRecordId");
const RECORD_ID_RANGE_SYMBOL = Symbol.for("surrealdb.RecordIdRange");
const UUID_SYMBOL = Symbol.for("surrealdb.Uuid");
const DATETIME_SYMBOL = Symbol.for("surrealdb.DateTime");
const DURATION_SYMBOL = Symbol.for("surrealdb.Duration");
const DECIMAL_SYMBOL = Symbol.for("surrealdb.Decimal");
const TABLE_SYMBOL = Symbol.for("surrealdb.Table");
const RANGE_SYMBOL = Symbol.for("surrealdb.Range");
const FUTURE_SYMBOL = Symbol.for("surrealdb.Future");
const FILE_REF_SYMBOL = Symbol.for("surrealdb.FileRef");
const GEOMETRY_SYMBOL = Symbol.for("surrealdb.Geometry");
const GEOMETRY_POINT_SYMBOL = Symbol.for("surrealdb.GeometryPoint");
const BOUND_INCLUDED_SYMBOL = Symbol.for("surrealdb.BoundIncluded");
const BOUND_EXCLUDED_SYMBOL = Symbol.for("surrealdb.BoundExcluded");
const GEOMETRY_LINE_SYMBOL = Symbol.for("surrealdb.GeometryLine");
const GEOMETRY_POLYGON_SYMBOL = Symbol.for("surrealdb.GeometryPolygon");
const GEOMETRY_MULTI_POINT_SYMBOL = Symbol.for("surrealdb.GeometryMultiPoint");
const GEOMETRY_MULTI_LINE_SYMBOL = Symbol.for("surrealdb.GeometryMultiLine");
const GEOMETRY_MULTI_POLYGON_SYMBOL = Symbol.for("surrealdb.GeometryMultiPolygon");
const GEOMETRY_COLLECTION_SYMBOL = Symbol.for("surrealdb.GeometryCollection");
const SURREAL_ERROR_SYMBOL = Symbol.for("surrealdb.SurrealError");

/**
 * Helper function to mark an object with a symbol
 */
export function markSymbol(obj: unknown, symbol: symbol): void {
    if (obj && typeof obj === "object") {
        (obj as Record<symbol, boolean>)[symbol] = true;
    }
}

/**
 * Helper function to check if an object has a symbol
 */
export function hasSymbol(obj: unknown, symbol: symbol): boolean {
    return !!(obj && typeof obj === "object" && (obj as Record<symbol, boolean>)[symbol]);
}

export {
    VALUE_SYMBOL,
    RECORD_ID_SYMBOL,
    STRING_RECORD_ID_SYMBOL,
    RECORD_ID_RANGE_SYMBOL,
    UUID_SYMBOL,
    DATETIME_SYMBOL,
    DURATION_SYMBOL,
    DECIMAL_SYMBOL,
    TABLE_SYMBOL,
    RANGE_SYMBOL,
    FUTURE_SYMBOL,
    FILE_REF_SYMBOL,
    GEOMETRY_SYMBOL,
    GEOMETRY_POINT_SYMBOL,
    GEOMETRY_LINE_SYMBOL,
    GEOMETRY_POLYGON_SYMBOL,
    GEOMETRY_MULTI_POINT_SYMBOL,
    GEOMETRY_MULTI_LINE_SYMBOL,
    GEOMETRY_MULTI_POLYGON_SYMBOL,
    GEOMETRY_COLLECTION_SYMBOL,
    BOUND_INCLUDED_SYMBOL,
    BOUND_EXCLUDED_SYMBOL,
    SURREAL_ERROR_SYMBOL,
};
