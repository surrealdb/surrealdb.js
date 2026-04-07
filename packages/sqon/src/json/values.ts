import type { GeoJson } from "../value/geometry";

export const createNone = () => ({ $none: true });
export const createDatetime = (value: string) => ({ $datetime: value });
export const createDecimal = (value: string) => ({ $decimal: value });
export const createDuration = (value: string) => ({ $duration: value });
export const createUuid = (value: string) => ({ $uuid: value });
export const createRecordId = (tb: string, id: unknown) => ({ $recordId: { tb, id } });
export const createStringRecordId = (value: string) => ({ $recordIdString: value });
export const createTable = (name: string) => ({ $table: name });
export const createRange = (begin: unknown, end: unknown) => ({ $range: { begin, end } });
export const createBoundIncluded = (value: unknown) => ({ $boundIncluded: value });
export const createBoundExcluded = (value: unknown) => ({ $boundExcluded: value });
export const createFile = (bucket: string, key: string) => ({ $file: { bucket, key } });
export const createFuture = (body: string) => ({ $future: body });
export const createBytes = (value: string) => ({ $bytes: value });
export const createGeometry = (value: unknown) => ({ $geometry: value });
export const createSet = (items: unknown[]) => ({ $set: items });

export const isNone = (value: object): value is { $none: true } => {
    return "$none" in value && value.$none === true;
};

export const isDatetime = (value: object): value is { $datetime: string } => {
    return "$datetime" in value && typeof value.$datetime === "string";
};

export const isDecimal = (value: object): value is { $decimal: string } => {
    return "$decimal" in value && typeof value.$decimal === "string";
};

export const isDuration = (value: object): value is { $duration: string } => {
    return "$duration" in value && typeof value.$duration === "string";
};

export const isUuid = (value: object): value is { $uuid: string } => {
    return "$uuid" in value && typeof value.$uuid === "string";
};

export const isRecordId = (value: object): value is { $recordId: { tb: string; id: unknown } } => {
    return (
        "$recordId" in value &&
        !!value.$recordId &&
        typeof value.$recordId === "object" &&
        "tb" in value.$recordId &&
        typeof value.$recordId.tb === "string" &&
        "id" in value.$recordId
    );
};

export const isTable = (value: object): value is { $table: string } => {
    return "$table" in value && typeof value.$table === "string";
};

export const isGeometry = (value: object): value is { $geometry: GeoJson } => {
    return "$geometry" in value && typeof value.$geometry === "object" && value.$geometry !== null;
};

export const isSet = (value: object): value is { $set: unknown[] } => {
    return "$set" in value && Array.isArray(value.$set);
};

export const isFile = (value: object): value is { $file: { bucket: string; key: string } } => {
    return "$file" in value && typeof value.$file === "object" && value.$file !== null;
};

export const isRange = (value: object): value is { $range: { begin: unknown; end: unknown } } => {
    return "$range" in value && typeof value.$range === "object" && value.$range !== null;
};

export const isBytes = (value: object): value is { $bytes: string } => {
    return "$bytes" in value && typeof value.$bytes === "string";
};

export const isFuture = (value: object): value is { $future: string } => {
    return "$future" in value && typeof value.$future === "string";
};

export const isBoundIncluded = (value: object): value is { $boundIncluded: unknown } => {
    return "$boundIncluded" in value;
};

export const isBoundExcluded = (value: object): value is { $boundExcluded: unknown } => {
    return "$boundExcluded" in value;
};
