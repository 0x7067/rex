import { describe, expect, it } from "vitest";
import { createResource, ResourceSchema } from "../../src/core/resource.js";

const validSnapshot = {
  type: "local" as const,
  absolute_path: "/tmp/my-project",
};

const validInput = {
  name: "my-project",
  type: "local" as const,
  source: "./my-project",
  normalized_source: "/tmp/my-project",
  notes: "",
  include_rules: [],
  exclude_rules: [],
  snapshot_metadata: validSnapshot,
};

describe("createResource", () => {
  it("generates a UUID id", () => {
    const r = createResource(validInput);
    expect(r.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  it("sets last_sync_status to pending", () => {
    const r = createResource(validInput);
    expect(r.last_sync_status).toBe("pending");
  });

  it("sets last_sync_at to null", () => {
    const r = createResource(validInput);
    expect(r.last_sync_at).toBeNull();
  });

  it("sets chunk_count to 0", () => {
    const r = createResource(validInput);
    expect(r.chunk_count).toBe(0);
  });

  it("sets index_profile for new resources", () => {
    const r = createResource(validInput);
    expect(r.index_profile).toMatchObject({
      embed_model: "nomic-ai/nomic-embed-text-v1.5",
      chunker_version: "boundary-v3",
      index_schema_version: "3",
    });
  });

  it("generates unique IDs for each call", () => {
    const r1 = createResource(validInput);
    const r2 = createResource(validInput);
    expect(r1.id).not.toBe(r2.id);
  });
});

describe("ResourceSchema", () => {
  it("parses a valid resource", () => {
    const data = {
      id: crypto.randomUUID(),
      name: "test",
      type: "local",
      source: "./test",
      normalized_source: "/tmp/test",
      notes: "",
      include_rules: [],
      exclude_rules: [],
      snapshot_metadata: { type: "local", absolute_path: "/tmp/test" },
      last_sync_status: "ok",
      last_sync_at: "2026-01-01T00:00:00Z",
      chunk_count: 42,
      index_profile: {
        embed_model: "nomic-ai/nomic-embed-text-v1.5",
        chunker_version: "boundary-v2",
        index_schema_version: "2",
      },
    };
    const parsed = ResourceSchema.safeParse(data);
    expect(parsed.success).toBe(true);
  });

  it("treats missing index_profile as null for older registries", () => {
    const data = {
      ...createResource(validInput),
      index_profile: undefined,
    };
    const parsed = ResourceSchema.safeParse(data);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.index_profile).toBeNull();
    }
  });

  it("rejects missing required fields", () => {
    const parsed = ResourceSchema.safeParse({ name: "test" });
    expect(parsed.success).toBe(false);
  });

  it("rejects invalid type", () => {
    const data = { ...createResource(validInput), type: "invalid" };
    const parsed = ResourceSchema.safeParse(data);
    expect(parsed.success).toBe(false);
  });
});
