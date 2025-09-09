import { dirname } from "node:path";
import { Glob } from "bun";

export interface Package {
    name: string;
    path: string;
    version: string;
}

export async function resolvePackages(): Promise<Package[]> {
    const glob = new Glob("./packages/*/package.json");
    const packages: Package[] = [];

    for await (const file of glob.scan(".")) {
        const packageJson = await Bun.file(file).json();

        if (!packageJson.version) {
            continue;
        }

        packages.push({
            name: packageJson.name,
            path: dirname(file),
            version: packageJson.version,
        });
    }

    return packages;
}

export function normalizeVersion(version: string): [string, string] {
    const [packageVersion, surrealVersion] = version.split(/[.-]surreal\./);
    const trimmed = packageVersion.replace(/^v/, "");

    return [trimmed, surrealVersion];
}

export function composeVersion(packageVersion: string, surrealVersion: string): string {
    if (packageVersion.includes("-")) {
        return `${packageVersion}.surreal.${surrealVersion}`;
    }

    return `${packageVersion}-surreal.${surrealVersion}`;
}
