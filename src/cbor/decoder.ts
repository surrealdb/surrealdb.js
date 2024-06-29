import type { Replacer } from "./constants";
import { CborBreak, CborInvalidMajorError } from "./error";
import { Reader } from "./reader";
import { Tagged } from "./tagged";
import { infiniteBytes } from "./util";

interface DecodeOptions {
    map?: "object" | "map";
    replacer?: Replacer;
}

export function decode(
    input: ArrayBufferLike | Reader,
    options: DecodeOptions = {},
    // biome-ignore lint/suspicious/noExplicitAny: Don't know what it will return
): any {
    const inner = () => {
        const r = input instanceof Reader ? input : new Reader(input);
        const [major, len] = r.readMajor();
        switch (major) {
            case 0:
                return r.readMajorLength(len);
            case 1: {
                const l = r.readMajorLength(len);
                return typeof l === "bigint" ? -(l + 1n) : -(l + 1);
            }
            case 2: {
                if (len === 31) return infiniteBytes(r, 2);
                return r.readBytes(Number(r.readMajorLength(len))).buffer;
            }
            case 3: {
                const encoded =
                    len === 31
                        ? infiniteBytes(r, 3)
                        : r.readBytes(Number(r.readMajorLength(len)));

                const textDecoder = new TextDecoder();
                return textDecoder.decode(encoded);
            }

            case 4: {
                if (len === 31) {
                    const arr: unknown[] = [];
                    while (true) {
                        try {
                            arr.push(decode(r, options));
                        } catch (e) {
                            if (e instanceof CborBreak) break;
                            throw e;
                        }
                    }

                    return arr;
                }

                return new Array(r.readMajorLength(len))
                    .fill(0)
                    .map(() => decode(r, options));
            }

            case 5: {
                const map = new Map();

                if (len === 31) {
                    while (true) {
                        let key: unknown;
                        try {
                            key = decode(r, options);
                        } catch (e) {
                            if (e instanceof CborBreak) break;
                            throw e;
                        }

                        const value = decode(r, options);
                        map.set(key, value);
                    }
                } else {
                    const l = r.readMajorLength(len);
                    for (let i = 0; i < l; i++) {
                        const key = decode(r, options);
                        const value = decode(r, options);
                        map.set(key, value);
                    }
                }

                return options.map !== "map"
                    ? Object.fromEntries(map.entries())
                    : map;
            }

            case 6: {
                const tag = r.readMajorLength(len);
                const value = decode(r, options);
                return new Tagged(tag, value);
            }

            case 7: {
                switch (len) {
                    case 20:
                        return false;
                    case 21:
                        return true;
                    case 22:
                        return null;
                    case 23:
                        return undefined;
                    case 25:
                        return r.readFloat16();
                    case 26:
                        return r.readFloat32();
                    case 27:
                        return r.readFloat64();
                    case 31:
                        throw new CborBreak();
                }
            }
        }

        throw new CborInvalidMajorError(
            `Unable to decode value with major tag ${major}`,
        );
    };

    return options.replacer ? options.replacer(inner()) : inner();
}
