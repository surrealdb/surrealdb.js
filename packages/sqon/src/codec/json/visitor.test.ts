import { expect, test } from "bun:test";
import { JsonCodec } from "./codec.ts";

interface CustomShape {
    $custom: {
        property: string;
    };
}

class Custom {
    constructor(public property: string) {}

    encode(): CustomShape {
        return { $custom: { property: this.property } };
    }

    static decode(input: CustomShape): Custom {
        return new Custom(input.$custom.property);
    }

    static isCustomShape(input: unknown): input is CustomShape {
        if (typeof input !== "object" || input === null) return false;
        const keys = Object.keys(input);
        return keys.length === 1 && keys[0] === "$custom";
    }
}

test("codec visitor hooks round-trip custom values", () => {
    const codec = new JsonCodec({
        valueEncodeVisitor: (x) => (x instanceof Custom ? x.encode() : x),
        valueDecodeVisitor: (x) => (Custom.isCustomShape(x) ? Custom.decode(x) : x),
    });

    const input = { prop: new Custom("foobar") };
    const enc = codec.encode(input);
    const dec = codec.decode<typeof input>(enc);

    expect(enc).toEqual({ prop: { $custom: { property: "foobar" } } });
    expect(dec).toEqual(input);
});

test("plain data with a $-prefixed key is still escaped when no visitor transforms it", () => {
    const codec = new JsonCodec({
        valueEncodeVisitor: (x) => (x instanceof Custom ? x.encode() : x),
        valueDecodeVisitor: (x) => (Custom.isCustomShape(x) ? Custom.decode(x) : x),
    });

    const input = { $literal: "not a custom value" };
    const enc = codec.encode(input);
    const dec = codec.decode(enc);

    expect(enc).toEqual({ $object: { $literal: "not a custom value" } });
    expect(dec).toEqual(input);
});

test("literal data shaped like a custom marker is not mistaken for a real Custom instance", () => {
    const codec = new JsonCodec({
        valueEncodeVisitor: (x) => (x instanceof Custom ? x.encode() : x),
        valueDecodeVisitor: (x) => (Custom.isCustomShape(x) ? Custom.decode(x) : x),
    });

    // Not a `Custom` instance -- just plain data that happens to share its wire shape.
    const input = { prop: { $custom: { property: "foobar" } } };
    const enc = codec.encode(input);
    const dec = codec.decode(enc);

    expect(enc).toEqual({ prop: { $object: { $custom: { property: "foobar" } } } });
    expect(dec).toEqual(input);
    expect(dec.prop).not.toBeInstanceOf(Custom);
});
