import { InvalidTableError } from "../errors";
import { hasSymbol, markSymbol, STRING_RECORD_ID_SYMBOL } from "../utils/symbols";
import { RecordId } from "./record-id";
import { Value } from "./value";

/**
 * A SurrealQL string-represented record ID value.
 */
export class StringRecordId extends Value {
    static override [Symbol.hasInstance](instance: unknown): boolean {
        return hasSymbol(instance, STRING_RECORD_ID_SYMBOL);
    }

    readonly rid: string;

    constructor(rid: string | StringRecordId | RecordId) {
        super();

        // In some cases the same method may be used with different data sources
        // this can cause this method to be called with an already instanced class object.
        if (rid instanceof StringRecordId) {
            this.rid = (rid as unknown as StringRecordId).rid;
        } else if (rid instanceof RecordId) {
            this.rid = (rid as unknown as RecordId).toString();
        } else if (typeof rid === "string") {
            this.rid = rid;
        } else {
            throw new InvalidTableError("String Record ID must be a string");
        }
        markSymbol(this, STRING_RECORD_ID_SYMBOL);
    }

    equals(other: unknown): boolean {
        if (!(other instanceof StringRecordId)) return false;
        return this.rid === (other as unknown as StringRecordId).rid;
    }

    toJSON(): string {
        return this.rid;
    }

    /**
     * @returns The string representation of the record ID
     */
    toString(): string {
        return this.rid;
    }
}
