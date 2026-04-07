import { JsonCodec } from "../codec/json/codec.ts";
import { InvalidTableError } from "../errors.ts";
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

    readonly #rid: string;

    constructor(rid: string | StringRecordId | RecordId) {
        super();

        if (rid instanceof StringRecordId) {
            this.#rid = rid.#rid;
        } else if (rid instanceof RecordId) {
            this.#rid = rid.toString();
        } else if (typeof rid === "string") {
            this.#rid = rid;
        } else {
            throw new InvalidTableError("String Record ID must be a string");
        }
        markSymbol(this, STRING_RECORD_ID_SYMBOL);
    }

    equals(other: unknown): boolean {
        if (!(other instanceof StringRecordId)) return false;
        return this.#rid === other.#rid;
    }

    toJSON(): unknown {
        if (Value.useExperimentalToJson) {
            return JsonCodec.default.encode(this);
        }
        return this.#rid;
    }

    toString(): string {
        return this.#rid;
    }
}
