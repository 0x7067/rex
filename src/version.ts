import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

let cachedVersion: string | null = null;

export function getCliVersion(): string {
  if (cachedVersion) return cachedVersion;

  const packageJsonPath = findPackageJson(path.dirname(fileURLToPath(import.meta.url)));
  const packageJson = JSON.parse(
    fs.readFileSync(packageJsonPath, "utf-8"),
  ) as { version?: string };

  cachedVersion = packageJson.version ?? "0.0.0-dev";
  return cachedVersion;
}

function findPackageJson(startDir: string): string {
  let currentDir = startDir;

  while (true) {
    const candidate = path.join(currentDir, "package.json");
    if (fs.existsSync(candidate)) {
      return candidate;
    }

    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      throw new Error(`Could not find package.json above ${startDir}`);
    }
    currentDir = parentDir;
  }
}
