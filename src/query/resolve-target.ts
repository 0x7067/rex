import path from "node:path";
import type { Resource } from "../core/resource.js";

export function getMaterializedDir(resource: Resource): string {
  switch (resource.snapshot_metadata.type) {
    case "local":
      return resource.snapshot_metadata.absolute_path;
    case "git":
      return resource.snapshot_metadata.clone_path;
    case "package":
      return resource.snapshot_metadata.extract_path;
  }
}

export function resolveTargetResources(
  cwd: string,
  allResources: Resource[],
  explicitNames: string[],
  options: { requireMatch?: boolean } = {},
): Resource[] {
  if (explicitNames.length > 0) {
    return explicitNames.map((name) => {
      const r = allResources.find((res) => res.name === name);
      if (!r) throw new Error(`Resource "${name}" not found.`);
      return r;
    });
  }

  const matches = allResources.filter((r) => {
    try {
      const materializedPath = getMaterializedDir(r);
      return cwd === materializedPath || cwd.startsWith(materializedPath + path.sep);
    } catch {
      return false;
    }
  });

  if (matches.length > 0) {
    return [...matches].sort(
      (a, b) => getMaterializedDir(b).length - getMaterializedDir(a).length,
    );
  }

  if (options.requireMatch) {
    throw new Error("No resource found for current directory. Use -r <name> to specify.");
  }

  return allResources;
}
