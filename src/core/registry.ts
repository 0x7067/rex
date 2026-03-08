import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { registryPath, rexHome } from "./config.js";
import {
  type ProviderConfig,
  ProviderConfigSchema,
  type Resource,
  ResourceSchema,
} from "./resource.js";

const RegistrySchema = z.object({
  version: z.literal(1),
  provider: ProviderConfigSchema.nullable(),
  resources: z.record(z.string(), ResourceSchema),
});

type Registry = z.infer<typeof RegistrySchema>;

export class RegistryError extends Error {
  constructor(
    message: string,
    public readonly code: "DUPLICATE_NAME" | "NOT_FOUND" | "CORRUPT" | "VERSION_MISMATCH",
  ) {
    super(message);
    this.name = "RegistryError";
  }
}

function emptyRegistry(): Registry {
  return { version: 1, provider: null, resources: {} };
}

function readRegistry(): Registry {
  const p = registryPath();
  if (!fs.existsSync(p)) {
    return emptyRegistry();
  }
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(p, "utf-8"));
  } catch {
    throw new RegistryError("Registry file is corrupt JSON", "CORRUPT");
  }
  const parsed = RegistrySchema.safeParse(raw);
  if (!parsed.success) {
    throw new RegistryError(
      `Registry schema invalid: ${parsed.error.message}`,
      "CORRUPT",
    );
  }
  return parsed.data;
}

function writeRegistry(registry: Registry): void {
  const p = registryPath();
  const dir = path.dirname(p);
  fs.mkdirSync(dir, { recursive: true });
  // Atomic write: write to temp file then rename
  const tmp = `${p}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(registry, null, 2), "utf-8");
  fs.renameSync(tmp, p);
}

export function addResource(resource: Resource): Resource {
  const registry = readRegistry();
  const existing = Object.values(registry.resources).find(
    (r) => r.name === resource.name,
  );
  if (existing) {
    throw new RegistryError(
      `Resource with name "${resource.name}" already exists`,
      "DUPLICATE_NAME",
    );
  }
  registry.resources[resource.id] = resource;
  writeRegistry(registry);
  return resource;
}

export function removeResource(id: string): void {
  const registry = readRegistry();
  if (!registry.resources[id]) {
    throw new RegistryError(`Resource with id "${id}" not found`, "NOT_FOUND");
  }
  delete registry.resources[id];
  writeRegistry(registry);
}

export function getResourceByName(name: string): Resource {
  const registry = readRegistry();
  const resource = Object.values(registry.resources).find(
    (r) => r.name === name,
  );
  if (!resource) {
    throw new RegistryError(`Resource "${name}" not found`, "NOT_FOUND");
  }
  return resource;
}

export function getResourceById(id: string): Resource {
  const registry = readRegistry();
  const resource = registry.resources[id];
  if (!resource) {
    throw new RegistryError(`Resource with id "${id}" not found`, "NOT_FOUND");
  }
  return resource;
}

export function listResources(): Resource[] {
  const registry = readRegistry();
  return Object.values(registry.resources);
}

export function updateResource(resource: Resource): void {
  const registry = readRegistry();
  if (!registry.resources[resource.id]) {
    throw new RegistryError(
      `Resource with id "${resource.id}" not found`,
      "NOT_FOUND",
    );
  }
  registry.resources[resource.id] = resource;
  writeRegistry(registry);
}

export function setProvider(config: ProviderConfig): void {
  const registry = readRegistry();
  registry.provider = config;
  writeRegistry(registry);
}

export function getProvider(): ProviderConfig | null {
  return readRegistry().provider;
}
