import { JsonCodec } from "../json/codec.ts";
import { FILE_REF_SYMBOL, hasSymbol, markSymbol } from "../utils/symbols.ts";
import { Value } from "./value.ts";

/**
 * A SurrealQL file reference value.
 */
export class FileRef extends Value {
    static override [Symbol.hasInstance](instance: unknown): boolean {
        return hasSymbol(instance, FILE_REF_SYMBOL);
    }

    readonly #bucket: string;
    readonly #key: string;

    constructor(bucket: string, key: string) {
        super();
        this.#bucket = bucket;
        this.#key = key.startsWith("/") ? key : `/${key}`;
        markSymbol(this, FILE_REF_SYMBOL);
    }

    get bucket(): string {
        return this.#bucket;
    }

    get key(): string {
        return this.#key;
    }

    equals(other: unknown): boolean {
        if (!(other instanceof FileRef)) return false;
        return this.#bucket === other.#bucket && this.#key === other.#key;
    }

    toJSON(): unknown {
        if (Value.useExperimentalToJson) {
            return JsonCodec.default.encode(this);
        }
        return this.toString();
    }

    toString(): string {
        return `${fmtInner(this.#bucket, true)}:${fmtInner(this.#key, false)}`;
    }
}

export function fmtInner(str: string, escapeSlash: boolean): string {
    let result = "";

    for (let i = 0; i < str.length; i++) {
        const char = str[i];
        const code = str.charCodeAt(i);

        if (
            (code >= 48 && code <= 57) || // numeric (0-9)
            (code >= 65 && code <= 90) || // upper alpha (A-Z)
            (code >= 97 && code <= 122) || // lower alpha (a-z)
            code === 95 || // underscore (_)
            code === 45 || // dash (-)
            code === 46 || // dot (.)
            (!escapeSlash && code === 47) // slash (/) - only if not escaping slashes
        ) {
            result += char;
        } else {
            result += `\\${char}`;
        }
    }

    return result;
}
