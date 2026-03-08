import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  addResource,
  getResourceByName,
  getResourceById,
  listResources,
  removeResource,
  RegistryError,
  setProvider,
  getProvider,
} from "../../src/core/registry.js";
import { createResource } from "../../src/core/resource.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rex-registry-test-"));
  process.env["REX_HOME"] = tmpDir;
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  delete process.env["REX_HOME"];
});

function makeResource(name: string) {
  return createResource({
    name,
    type: "local",
    source: `./${name}`,
    normalized_source: `/tmp/${name}`,
    notes: "",
    include_rules: [],
    exclude_rules: [],
    snapshot_metadata: { type: "local", absolute_path: `/tmp/${name}` },
  });
}

describe("registry", () => {
  it("returns empty list when registry file does not exist", () => {
    expect(listResources()).toEqual([]);
  });

  it("adds a resource and lists it", () => {
    const r = makeResource("test-a");
    addResource(r);
    const list = listResources();
    expect(list).toHaveLength(1);
    expect(list[0]?.name).toBe("test-a");
  });

  it("throws DUPLICATE_NAME on duplicate name", () => {
    addResource(makeResource("dupe"));
    expect(() => addResource(makeResource("dupe"))).toThrow(RegistryError);
    try {
      addResource(makeResource("dupe"));
    } catch (e) {
      expect((e as RegistryError).code).toBe("DUPLICATE_NAME");
    }
  });

  it("getResourceByName finds by name", () => {
    const r = makeResource("find-me");
    addResource(r);
    const found = getResourceByName("find-me");
    expect(found.id).toBe(r.id);
  });

  it("getResourceByName throws NOT_FOUND for unknown name", () => {
    expect(() => getResourceByName("nope")).toThrow(RegistryError);
  });

  it("getResourceById finds by UUID", () => {
    const r = makeResource("by-id");
    addResource(r);
    const found = getResourceById(r.id);
    expect(found.name).toBe("by-id");
  });

  it("removeResource deletes by UUID, not name", () => {
    const r = makeResource("to-remove");
    addResource(r);
    removeResource(r.id);
    expect(listResources()).toHaveLength(0);
  });

  it("removeResource throws NOT_FOUND for unknown id", () => {
    expect(() => removeResource(crypto.randomUUID())).toThrow(RegistryError);
  });

  it("persists across reads", () => {
    const r = makeResource("persist");
    addResource(r);
    // Clear any in-memory state by re-reading from disk
    const list = listResources();
    expect(list.some((x) => x.name === "persist")).toBe(true);
  });

  it("setProvider and getProvider round-trip", () => {
    setProvider({ name: "ollama", model: "llama3", endpoint: null });
    const p = getProvider();
    expect(p?.name).toBe("ollama");
    expect(p?.model).toBe("llama3");
  });
});
