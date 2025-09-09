import { dirname } from "node:path";
import { Glob } from "bun";

export interface Package {
    name: string;
    path: string;
    version: string;
    peerDependencies: Record<string, string>;
    devDependencies: Record<string, string>;
}

export async function resolvePackages(): Promise<Map<string, Package>> {
    const glob = new Glob("./packages/*/package.json");
    const packages: Map<string, Package> = new Map();

    for await (const file of glob.scan(".")) {
        const packageJson = await Bun.file(file).json();

        if (!packageJson.version) {
            continue;
        }

        packages.set(packageJson.name, {
            ...packageJson,
            path: dirname(file),
        });
    }

    return packages;
}
