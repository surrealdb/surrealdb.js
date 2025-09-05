let id = 0;

export function getIncrementalID(): string {
    id = (id + 1) % Number.MAX_SAFE_INTEGER;
    return id.toString();
}

export function resetIncrementalID(): void {
    id = 0;
}
