import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { Resource, SnapshotMetadata } from "../core/resource.js";
import type { FileEntry, ResourceAdapter } from "./adapter.js";

const NPM_PACKAGE_PATTERN = /^(npm:)?(@?[\w][\w.-]*\/[\w][\w.-]*|[\w][\w.-]*)(@[\d.]+)?$/;

function parsePackageSource(source: string): {
  name: string;
  version: string | null;
} {
  const cleaned = source.replace(/^npm:/, "");
  const atIdx = cleaned.lastIndexOf("@");
  if (atIdx > 0) {
    return {
      name: cleaned.slice(0, atIdx),
      version: cleaned.slice(atIdx + 1),
    };
  }
  return { name: cleaned, version: null };
}

function registryPackagePath(packageName: string): string {
  return packageName.replace("/", "%2f");
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Registry request failed: ${response.status} ${response.statusText}`);
  }
  return response.json() as Promise<T>;
}

async function resolveVersion(packageName: string, version: string | null): Promise<string> {
  if (version) return version;

  const metadata = await fetchJson<{ "dist-tags"?: { latest?: string } }>(
    `https://registry.npmjs.org/${registryPackagePath(packageName)}`,
  );
  const latest = metadata["dist-tags"]?.latest;
  if (!latest) {
    throw new Error(`Failed to resolve version for package: ${packageName}`);
  }
  return latest;
}

async function resolveTarballUrl(packageName: string, version: string): Promise<string> {
  const metadata = await fetchJson<{ dist?: { tarball?: string } }>(
    `https://registry.npmjs.org/${registryPackagePath(packageName)}/${version}`,
  );
  const tarball = metadata.dist?.tarball;
  if (!tarball) {
    throw new Error(`Failed to resolve tarball for package: ${packageName}@${version}`);
  }
  return tarball;
}

async function downloadTarball(tarballUrl: string): Promise<Buffer> {
  const response = await fetch(tarballUrl);
  if (!response.ok) {
    throw new Error(`Tarball download failed: ${response.status} ${response.statusText}`);
  }
  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

export class PackageAdapter implements ResourceAdapter {
  readonly type = "package" as const;

  detect(source: string): boolean {
    return NPM_PACKAGE_PATTERN.test(source) && !source.startsWith("./") && !source.startsWith("/");
  }

  async normalize(source: string): Promise<string> {
    const { name, version } = parsePackageSource(source);
    const resolved = await resolveVersion(name, version);
    return `npm:${name}@${resolved}`;
  }

  async materialize(
    normalizedSource: string,
    targetDir: string,
  ): Promise<SnapshotMetadata> {
    const { name, version } = parsePackageSource(normalizedSource);
    if (!version) throw new Error(`Normalized source must include version: ${normalizedSource}`);

    const extractPath = path.join(targetDir, `${name.replace("/", "__")}@${version}`);

    if (!fs.existsSync(extractPath)) {
      fs.mkdirSync(extractPath, { recursive: true });
      try {
        const tarballUrl = await resolveTarballUrl(name, version);
        const tarballFile = path.basename(new URL(tarballUrl).pathname) || `${name}@${version}.tgz`;
        const tarballPath = path.join(extractPath, tarballFile);
        fs.writeFileSync(tarballPath, await downloadTarball(tarballUrl));
        execFileSync("tar", ["-xzf", tarballPath, "-C", extractPath, "--strip-components=1"], {
          timeout: 15000,
        });
        fs.unlinkSync(tarballPath);
      } catch (err) {
        fs.rmSync(extractPath, { recursive: true, force: true });
        throw new Error(
          `Failed to extract package ${normalizedSource}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    return {
      type: "package",
      extract_path: extractPath,
      package_name: name,
      resolved_version: version,
      registry_url: `https://registry.npmjs.org/${name}`,
    };
  }

  reference(entry: FileEntry, resource: Resource): string {
    if (resource.snapshot_metadata.type === "package") {
      const { package_name, resolved_version } = resource.snapshot_metadata;
      return `${package_name}@${resolved_version}: ${entry.relativePath}`;
    }
    return `${resource.name}: ${entry.relativePath}`;
  }
}

export const packageAdapter = new PackageAdapter();
