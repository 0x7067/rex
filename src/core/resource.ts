import { z } from "zod";
import { getCurrentIndexProfile } from "../indexing/profile.js";

export const ResourceTypeSchema = z.enum(["local", "git", "package"]);
export type ResourceType = z.infer<typeof ResourceTypeSchema>;

export const SyncStatusSchema = z.enum(["ok", "failed", "partial", "pending"]);
export type SyncStatus = z.infer<typeof SyncStatusSchema>;

export const LocalSnapshotMetadataSchema = z.object({
  absolute_path: z.string(),
});

export const GitSnapshotMetadataSchema = z.object({
  clone_path: z.string(),
  remote_url: z.string(),
  branch: z.string(),
  last_commit_sha: z.string(),
});

export const PackageSnapshotMetadataSchema = z.object({
  extract_path: z.string(),
  package_name: z.string(),
  resolved_version: z.string(),
  registry_url: z.string(),
});

export const SnapshotMetadataSchema = z.discriminatedUnion("type", [
  LocalSnapshotMetadataSchema.extend({ type: z.literal("local") }),
  GitSnapshotMetadataSchema.extend({ type: z.literal("git") }),
  PackageSnapshotMetadataSchema.extend({ type: z.literal("package") }),
]);

export type SnapshotMetadata = z.infer<typeof SnapshotMetadataSchema>;

export const IndexProfileSchema = z.object({
  embed_model: z.string().min(1),
  chunker_version: z.string().min(1),
  index_schema_version: z.string().min(1),
});

export type IndexProfile = z.infer<typeof IndexProfileSchema>;

export const ResourceSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  type: ResourceTypeSchema,
  source: z.string().min(1),
  normalized_source: z.string().min(1),
  notes: z.string().default(""),
  include_rules: z.array(z.string()).default([]),
  exclude_rules: z.array(z.string()).default([]),
  snapshot_metadata: SnapshotMetadataSchema,
  last_sync_status: SyncStatusSchema,
  last_sync_at: z.string().nullable(),
  chunk_count: z.number().int().nonnegative(),
  index_profile: IndexProfileSchema.nullable().optional().default(null),
});

export type Resource = z.infer<typeof ResourceSchema>;

export type ResourceCreateInput = Omit<
  Resource,
  "id" | "last_sync_status" | "last_sync_at" | "chunk_count" | "index_profile"
>;

export function createResource(input: ResourceCreateInput): Resource {
  return ResourceSchema.parse({
    ...input,
    id: crypto.randomUUID(),
    last_sync_status: "pending",
    last_sync_at: null,
    chunk_count: 0,
    index_profile: getCurrentIndexProfile(),
  });
}

export const ProviderNameSchema = z.enum(["ollama", "claude", "codex"]);
export type ProviderName = z.infer<typeof ProviderNameSchema>;

export const ProviderConfigSchema = z.object({
  name: ProviderNameSchema,
  model: z.string().nullable(),
  endpoint: z.string().nullable(),
});

export type ProviderConfig = z.infer<typeof ProviderConfigSchema>;
