import type { Replacer } from "./constants";
import { CborBreak, CborInvalidMajorError } from "./error";
import { Reader } from "./reader";
import { Tagged } from "./tagged";
import { infiniteBytes } from "./util";

const textDecoder = new TextDecoder();

export interface DecodeOptions {
    map?: "object" | "map";
    tagged?: Record<number, Replacer>;
}

export function decode(
    input: Uint8Array | Reader,
    options: DecodeOptions = {},
    // biome-ignore lint/suspicious/noExplicitAny: We don't know what it will return
): any {
    const r = input instanceof Reader ? input : new Reader(input);
    return decodeValue(r, options);
}

// biome-ignore lint/suspicious/noExplicitAny: We don't know what it will return
function decodeValue(r: Reader, options: DecodeOptions): any {
    const [major, len] = r.readMajor();
    switch (major) {
        case 0:
            return r.readMajorLength(len);
        case 1: {
            const l = r.readMajorLength(len);
            return typeof l === "bigint" ? -(l + 1n) : -(l + 1);
        }
        case 2: {
            if (len !== 31)
                return new Uint8Array(r.readBytes(Number(r.readMajorLength(len)))).buffer;
            return infiniteBytes(r, 2);
        }
        case 3: {
            const encoded =
                len !== 31 ? r.readBytes(Number(r.readMajorLength(len))) : infiniteBytes(r, 3);

            return textDecoder.decode(encoded);
        }

        case 4: {
            if (len !== 31) {
                const l = r.readMajorLength(len);
                const arr = Array(l);
                for (let i = 0; i < l; i++) arr[i] = decodeValue(r, options);
                return arr;
            }

            const arr = [];
            for (;;) {
                const byte = r.peekUint8();
                if (byte === 0xff) {
                    r.skip();
                    break;
                }
                arr.push(decodeValue(r, options));
            }

            return arr;
        }

        case 5: {
            if (options.map === "map") {
                const map = new Map<string, unknown>();
                if (len !== 31) {
                    const l = r.readMajorLength(len);
                    for (let i = 0; i < l; i++) {
                        map.set(decodeValue(r, options), decodeValue(r, options));
                    }
                } else {
                    for (;;) {
                        const byte = r.peekUint8();
                        if (byte === 0xff) {
                            r.skip();
                            break;
                        }

                        map.set(decodeValue(r, options), decodeValue(r, options));
                    }
                }

                return map;
            }

            const obj: Record<string, unknown> = {};
            if (len !== 31) {
                const l = r.readMajorLength(len);
                for (let i = 0; i < l; i++) {
                    obj[decodeValue(r, options)] = decodeValue(r, options);
                }
            } else {
                for (;;) {
                    const byte = r.peekUint8();
                    if (byte === 0xff) {
                        r.skip();
                        break;
                    }

                    obj[decodeValue(r, options)] = decodeValue(r, options);
                }
            }

            return obj;
        }

        case 6: {
            const tag = Number(r.readMajorLength(len));
            const value = decodeValue(r, options);
            const replacer = options.tagged?.[tag];
            if (replacer) return replacer(value);
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

    throw new CborInvalidMajorError(`Unable to decode value with major tag ${major}`);
}
