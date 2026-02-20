import { InvalidTableError } from "../errors";
import { RecordId } from "./record-id";
import { Value } from "./value";

/**
 * A SurrealQL string-represented record ID value.
 */
export class StringRecordId extends Value {
    readonly #rid: string;

    constructor(rid: string | StringRecordId | RecordId) {
        super();

        // In some cases the same method may be used with different data sources
        // this can cause this method to be called with an already instanced class object.
        if (rid instanceof StringRecordId) {
            this.#rid = rid.#rid;
        } else if (rid instanceof RecordId) {
            this.#rid = rid.toString();
        } else if (typeof rid === "string") {
            this.#rid = rid;
        } else {
            throw new InvalidTableError("String Record ID must be a string");
        }
    }

    equals(other: unknown): boolean {
        if (!(other instanceof StringRecordId)) return false;
        return this.#rid === other.#rid;
    }

    toJSON(): string {
        return this.#rid;
    }

    /**
     * @returns The string representation of the record ID
     */
    toString(): string {
        return this.#rid;
    }
}
