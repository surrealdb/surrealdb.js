import { ShapedFrameError } from "../../errors.ts";
import { CborCodec, type CborCodecOptions } from "../cbor/codec.ts";
import type { BlockReader, DynamicDecoder } from "./block.ts";
import { ShapedBlock } from "./block.ts";
import { SHAPED_TAG } from "./constants.ts";

/**
 * The codec of the `shaped` format: `cbor.2`, plus the tag 57 blocks which carry a list of
 * result rows.
 *
 * Everything which is not a row list — the response envelope, `begin`, `value`, `finished` and
 * `end` stream frames, a notification's `id`, `action` and `record`, errors — is `cbor.2` as
 * the CBOR codec writes it, so this codec is that codec with one tag added.
 *
 * Tag 57 decodes to a {@link ShapedBlock}, which still holds its bytes. The shape ids in a
 * block are resolved against a scope wider than the block itself, so the caller reads a block
 * through the {@link BlockReader} of its scope once the envelope says which scope that is.
 */
export class ShapedCodec extends CborCodec {
    constructor(options: Omit<CborCodecOptions, "version"> = {}) {
        super({ ...options, version: 2 });

        // Set here rather than as a field: the base class holds `tagged` as an instance field,
        // which a subclass field initializer would replace wholesale rather than add to.
        this.tagged = {
            ...this.tagged,
            [SHAPED_TAG]: (v) => {
                // A CBOR byte string decodes to an ArrayBuffer
                if (v instanceof ArrayBuffer) return new ShapedBlock(new Uint8Array(v));
                if (v instanceof Uint8Array) return new ShapedBlock(v);
                throw new ShapedFrameError("a block that is not a byte string");
            },
        };
    }

    /** A decoder for the one CBOR item a dynamic slice holds */
    get dynamic(): DynamicDecoder {
        return (bytes) => this.decode(bytes);
    }

    /** The rows of `block`, read in `scope` */
    rows(block: ShapedBlock, scope: BlockReader): unknown[] {
        return scope.read(block, this.dynamic);
    }
}
