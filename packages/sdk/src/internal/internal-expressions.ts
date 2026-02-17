import { ExpressionError } from "../errors";
import type { Expr, Output } from "../types";
import { Duration, RecordId } from "../value";

const OUTPUTS: Map<Output, string> = new Map([
    ["null", "null"],
    ["none", "NONE"],
    ["diff", "DIFF"],
    ["before", "BEFORE"],
    ["after", "AFTER"],
]);

export const _only = (value: unknown): Expr => ({
    toSQL: (ctx) => (value instanceof RecordId ? `ONLY ${ctx.def(value)}` : ctx.def(value)),
});

export const _output = (value: Output): Expr => ({
    toSQL: () => {
        const output = OUTPUTS.get(value);

        if (!output) {
            throw new ExpressionError(`Invalid output value: ${value}`);
        }

        return output;
    },
});

export const _timeout = (timeout: Duration): Expr => ({
    toSQL: () => {
        if (!(timeout instanceof Duration)) {
            throw new ExpressionError(`Invalid timeout value: ${timeout}`);
        }

        return `TIMEOUT ${timeout.toString()}`;
    },
});
