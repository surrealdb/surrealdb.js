import { type Major, Reader } from "@surrealdb/cbor";

/**
 * A reader which remembers the head of the item it read last, so that a tag can check what
 * kind of item it holds: the decoder hands it a JavaScript value, in which the integer 1 and
 * the float 1.0 are the same.
 */
export class StrictReader extends Reader {
    /** The major type of the item read last */
    major: Major = 0;

    /** The additional information of the item read last: 25, 26 or 27 for a float */
    info = 0;

    override readMajor(): [Major, number] {
        const head = super.readMajor();
        [this.major, this.info] = head;
        return head;
    }

    /** Whether the item read last is an integer */
    get isInteger(): boolean {
        return this.major === 0 || this.major === 1;
    }

    /** Whether the item read last is a float */
    get isFloat(): boolean {
        return this.major === 7 && this.info >= 25 && this.info <= 27;
    }
}
