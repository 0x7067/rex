import path from "node:path";
import os from "node:os";

export function rexHome(): string {
  return process.env["REX_HOME"] ?? path.join(os.homedir(), ".rex");
}

export function snapshotsDir(): string {
  return path.join(rexHome(), "snapshots");
}

export function lanceDir(): string {
  return path.join(rexHome(), "lance");
}

export function embeddingCacheDir(): string {
  return path.join(rexHome(), "cache", "embeddings");
}

export function registryPath(): string {
  return path.join(rexHome(), "registry.json");
}
// smoke test modification - Sat Mar  7 22:36:14 -03 2026
