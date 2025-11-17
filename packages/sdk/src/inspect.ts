import type { InspectOptions } from "node:util";
import { RecordId, RecordIdRange, StringRecordId } from "./value";

export function setUpCustomInspectors() {
    if (typeof process === "undefined") return;

    import("node:util").then((util) => {
        function customRecordIdInspect(
            this: RecordId | RecordIdRange | StringRecordId,
            _: unknown,
            options: InspectOptions,
        ) {
            if (options.colors) {
                // raw coloring, bright blue text
                return `\x1b[94m${this.toString()}\x1b[0m`;
            }

            return this.toString();
        }

        (RecordId.prototype as any)[util.inspect.custom] = customRecordIdInspect;
        (RecordIdRange.prototype as any)[util.inspect.custom] = customRecordIdInspect;
        (StringRecordId.prototype as any)[util.inspect.custom] = customRecordIdInspect;
    });
}
