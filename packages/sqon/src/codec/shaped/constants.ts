/**
 * The constants of the shaped block format, version 1.
 *
 * A block is a CBOR tag 57 around a byte string. Its contents are a version byte and then a
 * run of messages, each of which announces a shape or carries a batch of rows written in a
 * shape announced earlier. The format is specified in the server's
 * `doc/design/shaped-frames.md`; these names follow the ones it uses.
 */

/** The CBOR tag which wraps a block's byte string */
export const SHAPED_TAG = 57;

/** The only block version this decoder reads */
export const VERSION = 1;

/** A message which announces a shape under an id */
export const MESSAGE_SHAPE = 0x01;

/** A message which carries rows of a shape announced earlier */
export const MESSAGE_BATCH = 0x02;

/** The presence index, slot or remainder of a column which has none */
export const NO_SLOT = 0xffffffff;

/** A column flag: the column may be absent, or hold `NONE` */
export const MAY_BE_ABSENT = 0b01;

/** A column flag: the column may be `NULL` */
export const MAY_BE_NULL = 0b10;

/** Presence state: the row does not hold the key */
export const STATE_ABSENT = 0b00;

/** Presence state: the column holds a value */
export const STATE_VALUE = 0b01;

/** Presence state: the column is `NULL` */
export const STATE_NULL = 0b10;

/** Presence state: the row holds the key and its value is `NONE` */
export const STATE_NONE = 0b11;

/** The most columns a shape holds, at every depth */
export const MAX_COLUMNS = 4096;

/** The deepest object nesting a shape holds */
export const MAX_DEPTH = 32;

/** The most shapes one scope announces */
export const MAX_SHAPES = 65536;

/** The most rows one batch holds of a shape whose rows take no bytes */
export const MAX_EMPTY_ROWS = 65536;

/** The largest fixed region of a row */
export const MAX_FIXED = 1 << 20;

/** The root of a shape whose every row is an object built from the columns */
export const ROOT_OBJECT = 0;

/** The root of a shape whose every row is one value, held in a dynamic slot */
export const ROOT_VALUE = 1;

/** The presence bits a column of these flags takes: none, one, or two for a column which may be both */
export function presenceWidth(flags: number): number {
    const set = flags & (MAY_BE_ABSENT | MAY_BE_NULL);
    if (set === 0) return 0;
    return set === (MAY_BE_ABSENT | MAY_BE_NULL) ? 2 : 1;
}

/** The bytes a presence region of `bits` bits takes */
export function presenceBytes(bits: number): number {
    return Math.ceil(bits / 8);
}
