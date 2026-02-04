export function normalizePath(prefix: string, path: string): string {
    return `/${[...prefix.split("/"), ...path.split("/")].filter(Boolean).join("/")}`;
}
