import {
    isVersionSupported,
    MAXIMUM_VERSION,
    MINIMUM_VERSION,
} from "../utils/is-version-supported";

export class Feature {
    #name: string;
    #since?: string;
    #until?: string;

    constructor(name: string, since?: string, until?: string) {
        this.#name = name;
        this.#since = since;
        this.#until = until;
    }

    get name(): string {
        return this.#name;
    }

    get sinceVersion(): string | undefined {
        return this.#since;
    }

    get untilVersion(): string | undefined {
        return this.#until;
    }

    supports(version: string): boolean {
        return isVersionSupported(
            version,
            this.#since ?? MINIMUM_VERSION,
            this.#until ?? MAXIMUM_VERSION,
        );
    }
}
