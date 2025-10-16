import { Value } from "./value";

/**
 * A SurrealQL file reference value.
 */
export class FileRef extends Value {
    readonly #bucket: string;
    readonly #key: string;

    constructor(bucket: string, key: string) {
        super();
        this.#bucket = bucket;
        this.#key = key.startsWith("/") ? key : `/${key}`;
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

    toJSON(): string {
        return this.toString();
    }

    toString(): string {
        return `f"${fmtInner(this.#bucket, true)}:${fmtInner(this.#key, false)}"`;
    }
}

export function fmtInner(str: string, escapeSlash: boolean): string {
    let result = "";

    for (let i = 0; i < str.length; i++) {
        const char = str[i];
        const code = str.charCodeAt(i);

        // Check if character is allowed
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
