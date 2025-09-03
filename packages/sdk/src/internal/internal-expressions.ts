import type { Expr } from "../types";
import { RecordId } from "../value";

export const only = (value: unknown): Expr => ({
    toSQL: (ctx) => (value instanceof RecordId ? `ONLY ${ctx.def(value)}` : ctx.def(value)),
});
