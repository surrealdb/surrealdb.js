import { JsonCodec } from "../codec/json/codec.ts";
import { InvalidRecordIdError } from "../errors.ts";
import { hasSymbol, markSymbol, STRING_RECORD_ID_SYMBOL } from "../utils/symbols.ts";
import { RecordId } from "./record-id.ts";
import { Value } from "./value.ts";

/**
 * A SurrealQL string-represented record ID value.
 */
export class StringRecordId extends Value {
    static override [Symbol.hasInstance](instance: unknown): boolean {
        return hasSymbol(instance, STRING_RECORD_ID_SYMBOL);
    }

    private readonly _rid: string;

    constructor(rid: string | StringRecordId | RecordId) {
        super();

        if (rid instanceof StringRecordId) {
            this._rid = rid._rid;
        } else if (rid instanceof RecordId) {
            this._rid = rid.toString();
        } else if (typeof rid === "string") {
            this._rid = rid;
        } else {
            throw new InvalidRecordIdError("String Record ID must be a string");
        }
        markSymbol(this, STRING_RECORD_ID_SYMBOL);
    }

    equals(other: unknown): boolean {
        if (!(other instanceof StringRecordId)) return false;
        return this._rid === other._rid;
    }

    toJSON(): unknown {
        if (Value._useExperimentalToJson) {
            return JsonCodec.DEFAULT.encode(this);
        }
        return this._rid;
    }

    /**
     * @returns The string representation of the record ID
     */
    toString(): string {
        return this._rid;
    }
}
