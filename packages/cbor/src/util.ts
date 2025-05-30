import type { Major } from "./constants";
import { CborInvalidMajorError, CborRangeError } from "./error";
import type { Reader } from "./reader";
import { Writer } from "./writer";

export function infiniteBytes(r: Reader, forMajor: Major): ArrayBuffer {
	const w = new Writer();
	while (true) {
		const [major, len] = r.readMajor();

		// Received break signal
		if (major === 7 && len === 31) break;

		// Resource type has to match
		if (major !== forMajor)
			throw new CborInvalidMajorError(
				`Expected a resource of the same major (${forMajor}) while processing an infinite resource`,
			);

		// Cannot have an infinite resource in an infinite resource
		if (len === 31)
			throw new CborRangeError(
				"Expected a finite resource while processing an infinite resource",
			);

		w.writeUint8Array(r.readBytes(Number(r.readMajorLength(len))));
	}

	return w.buffer.buffer as ArrayBuffer;
}
