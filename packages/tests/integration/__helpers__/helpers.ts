import { SURREAL_PROTOCOL } from "./env";

export function proto(name: string): string {
    return `${name}-${SURREAL_PROTOCOL}`;
}
