/**
 * Used to widen the type of a record id primitive value.
 *
 * @example
 * ```ts
 * new TypedRecordId("test", "123"); // TypedRecordId<"test", string>
 * new TypedRecordId("test", 123); // TypedRecordId<"test", number>
 * ```
 *
 * Without widening the type would be:
 * ```ts
 * new TypedRecordId("test", "123"); // TypedRecordId<"test", "123">
 * new TypedRecordId("test", 123); // TypedRecordId<"test", 123>
 * ```
 *
 * Thus preventing us from declaring record ids in arrays or using them
 * interchangeably.
 */
export type WidenRecordIdValue<T> = T extends string
    ? string
    : T extends number
      ? number
      : T extends bigint
        ? bigint
        : T;
