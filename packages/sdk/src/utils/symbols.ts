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
const BOUND_QUERY_SYMBOL = Symbol.for("surrealdb.BoundQuery");
const GEOMETRY_LINE_SYMBOL = Symbol.for("surrealdb.GeometryLine");
const GEOMETRY_POLYGON_SYMBOL = Symbol.for("surrealdb.GeometryPolygon");
const GEOMETRY_MULTI_POINT_SYMBOL = Symbol.for("surrealdb.GeometryMultiPoint");
const GEOMETRY_MULTI_LINE_SYMBOL = Symbol.for("surrealdb.GeometryMultiLine");
const GEOMETRY_MULTI_POLYGON_SYMBOL = Symbol.for("surrealdb.GeometryMultiPolygon");
const GEOMETRY_COLLECTION_SYMBOL = Symbol.for("surrealdb.GeometryCollection");
const FRAME_SYMBOL = Symbol.for("surrealdb.Frame");
const VALUE_FRAME_SYMBOL = Symbol.for("surrealdb.ValueFrame");
const ERROR_FRAME_SYMBOL = Symbol.for("surrealdb.ErrorFrame");
const DONE_FRAME_SYMBOL = Symbol.for("surrealdb.DoneFrame");
const SURREAL_ERROR_SYMBOL = Symbol.for("surrealdb.SurrealError");
const SERVER_ERROR_SYMBOL = Symbol.for("surrealdb.ServerError");

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

/**
 * Type guard functions for symbol-based type checking
 */
export function isValue(obj: unknown): obj is { [VALUE_SYMBOL]: true } {
    return hasSymbol(obj, VALUE_SYMBOL);
}

export function isRecordId(obj: unknown): obj is { [RECORD_ID_SYMBOL]: true } {
    return hasSymbol(obj, RECORD_ID_SYMBOL);
}

export function isStringRecordId(obj: unknown): obj is { [STRING_RECORD_ID_SYMBOL]: true } {
    return hasSymbol(obj, STRING_RECORD_ID_SYMBOL);
}

export function isRecordIdRange(obj: unknown): obj is { [RECORD_ID_RANGE_SYMBOL]: true } {
    return hasSymbol(obj, RECORD_ID_RANGE_SYMBOL);
}

export function isUuid(obj: unknown): obj is { [UUID_SYMBOL]: true } {
    return hasSymbol(obj, UUID_SYMBOL);
}

export function isDateTime(obj: unknown): obj is { [DATETIME_SYMBOL]: true } {
    return hasSymbol(obj, DATETIME_SYMBOL);
}

export function isDuration(obj: unknown): obj is { [DURATION_SYMBOL]: true } {
    return hasSymbol(obj, DURATION_SYMBOL);
}

export function isDecimal(obj: unknown): obj is { [DECIMAL_SYMBOL]: true } {
    return hasSymbol(obj, DECIMAL_SYMBOL);
}

export function isTable(obj: unknown): obj is { [TABLE_SYMBOL]: true } {
    return hasSymbol(obj, TABLE_SYMBOL);
}

export function isRange(obj: unknown): obj is { [RANGE_SYMBOL]: true } {
    return hasSymbol(obj, RANGE_SYMBOL);
}

export function isFuture(obj: unknown): obj is { [FUTURE_SYMBOL]: true } {
    return hasSymbol(obj, FUTURE_SYMBOL);
}

export function isFileRef(obj: unknown): obj is { [FILE_REF_SYMBOL]: true } {
    return hasSymbol(obj, FILE_REF_SYMBOL);
}

export function isGeometry(obj: unknown): obj is { [GEOMETRY_SYMBOL]: true } {
    return hasSymbol(obj, GEOMETRY_SYMBOL);
}

export function isGeometryPoint(obj: unknown): obj is { [GEOMETRY_POINT_SYMBOL]: true } {
    return hasSymbol(obj, GEOMETRY_POINT_SYMBOL);
}

export function isGeometryLine(obj: unknown): obj is { [GEOMETRY_LINE_SYMBOL]: true } {
    return hasSymbol(obj, GEOMETRY_LINE_SYMBOL);
}

export function isGeometryPolygon(obj: unknown): obj is { [GEOMETRY_POLYGON_SYMBOL]: true } {
    return hasSymbol(obj, GEOMETRY_POLYGON_SYMBOL);
}

export function isGeometryMultiPoint(obj: unknown): obj is { [GEOMETRY_MULTI_POINT_SYMBOL]: true } {
    return hasSymbol(obj, GEOMETRY_MULTI_POINT_SYMBOL);
}

export function isGeometryMultiLine(obj: unknown): obj is { [GEOMETRY_MULTI_LINE_SYMBOL]: true } {
    return hasSymbol(obj, GEOMETRY_MULTI_LINE_SYMBOL);
}

export function isGeometryMultiPolygon(
    obj: unknown,
): obj is { [GEOMETRY_MULTI_POLYGON_SYMBOL]: true } {
    return hasSymbol(obj, GEOMETRY_MULTI_POLYGON_SYMBOL);
}

export function isGeometryCollection(obj: unknown): obj is { [GEOMETRY_COLLECTION_SYMBOL]: true } {
    return hasSymbol(obj, GEOMETRY_COLLECTION_SYMBOL);
}

export function isBoundQuery(obj: unknown): obj is { [BOUND_QUERY_SYMBOL]: true } {
    return hasSymbol(obj, BOUND_QUERY_SYMBOL);
}

export function isFrame(obj: unknown): obj is { [FRAME_SYMBOL]: true } {
    return hasSymbol(obj, FRAME_SYMBOL);
}

export function isValueFrame(obj: unknown): obj is { [VALUE_FRAME_SYMBOL]: true } {
    return hasSymbol(obj, VALUE_FRAME_SYMBOL);
}

export function isErrorFrame(obj: unknown): obj is { [ERROR_FRAME_SYMBOL]: true } {
    return hasSymbol(obj, ERROR_FRAME_SYMBOL);
}

export function isDoneFrame(obj: unknown): obj is { [DONE_FRAME_SYMBOL]: true } {
    return hasSymbol(obj, DONE_FRAME_SYMBOL);
}

export function isSurrealError(obj: unknown): obj is { [SURREAL_ERROR_SYMBOL]: true } {
    return hasSymbol(obj, SURREAL_ERROR_SYMBOL);
}

export function isServerError(obj: unknown): obj is { [SERVER_ERROR_SYMBOL]: true } {
    return hasSymbol(obj, SERVER_ERROR_SYMBOL);
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
    BOUND_QUERY_SYMBOL,
    FRAME_SYMBOL,
    VALUE_FRAME_SYMBOL,
    ERROR_FRAME_SYMBOL,
    DONE_FRAME_SYMBOL,
    SURREAL_ERROR_SYMBOL,
    SERVER_ERROR_SYMBOL,
};
