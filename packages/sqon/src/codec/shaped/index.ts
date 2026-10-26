export { BlockReader, type DynamicDecoder, decodeRow, ShapedBlock } from "./block.ts";
export { ShapedCodec } from "./codec.ts";
export {
    MAX_COLUMNS,
    MAX_DEPTH,
    MAX_FIXED,
    MAX_SHAPES,
    MAY_BE_ABSENT,
    MAY_BE_NULL,
    NO_SLOT,
    SHAPED_TAG,
    VERSION as SHAPED_VERSION,
} from "./constants.ts";
export { Kind } from "./kinds.ts";
export { type Column, Shape } from "./shape.ts";
