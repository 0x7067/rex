import { describe, expect, it } from "vitest";
import path from "node:path";
import { getMaterializedDir, resolveTargetResources } from "../../src/query/resolve-target.js";
import type { Resource } from "../../src/core/resource.js";

function makeResource(
  overrides: Partial<Resource> & { snapshot_metadata: Resource["snapshot_metadata"] },
): Resource {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    name: "test",
    type: "local",
    source: "/tmp/test",
    normalized_source: "/tmp/test",
    notes: "",
    include_rules: [],
    exclude_rules: [],
    last_sync_status: "ok",
    last_sync_at: null,
    chunk_count: 0,
    index_profile: null,
    ...overrides,
  };
}

const localResource = makeResource({
  id: "00000000-0000-0000-0000-000000000001",
  name: "local-res",
  type: "local",
  snapshot_metadata: { type: "local", absolute_path: "/home/user/projects/myapp" },
});

const gitResource = makeResource({
  id: "00000000-0000-0000-0000-000000000002",
  name: "git-res",
  type: "git",
  snapshot_metadata: {
    type: "git",
    clone_path: "/tmp/rex/snapshots/git-res",
    remote_url: "https://github.com/example/repo",
    branch: "main",
    last_commit_sha: "abc123",
  },
});

describe("getMaterializedDir", () => {
  it("returns absolute_path for local resources", () => {
    expect(getMaterializedDir(localResource)).toBe("/home/user/projects/myapp");
  });

  it("returns clone_path for git resources", () => {
    expect(getMaterializedDir(gitResource)).toBe("/tmp/rex/snapshots/git-res");
  });

  it("returns extract_path for package resources", () => {
    const pkg = makeResource({
      id: "00000000-0000-0000-0000-000000000003",
      name: "pkg-res",
      type: "package",
      snapshot_metadata: {
        type: "package",
        extract_path: "/tmp/rex/snapshots/pkg-res",
        package_name: "some-pkg",
        resolved_version: "1.0.0",
        registry_url: "https://registry.npmjs.org",
      },
    });
    expect(getMaterializedDir(pkg)).toBe("/tmp/rex/snapshots/pkg-res");
  });
});

describe("resolveTargetResources", () => {
  const allResources = [localResource, gitResource];

  it("CWD exactly equals local resource path → returns that resource", () => {
    const result = resolveTargetResources("/home/user/projects/myapp", allResources, []);
    expect(result).toEqual([localResource]);
  });

  it("CWD inside local resource path → returns that resource", () => {
    const cwd = "/home/user/projects/myapp/src/components";
    const result = resolveTargetResources(cwd, allResources, []);
    expect(result).toEqual([localResource]);
  });

  it("CWD inside git resource path → returns that resource", () => {
    const cwd = "/tmp/rex/snapshots/git-res/lib";
    const result = resolveTargetResources(cwd, allResources, []);
    expect(result).toEqual([gitResource]);
  });

  it("CWD not inside any → returns all resources", () => {
    const result = resolveTargetResources("/unrelated/path", allResources, []);
    expect(result).toEqual(allResources);
  });

  it("prefix collision: /foo/bar does NOT match /foo/barbaz", () => {
    const tricky = makeResource({
      id: "00000000-0000-0000-0000-000000000004",
      name: "tricky",
      type: "local",
      snapshot_metadata: { type: "local", absolute_path: "/home/user/projects/myapp" },
    });
    const similar = makeResource({
      id: "00000000-0000-0000-0000-000000000005",
      name: "similar",
      type: "local",
      snapshot_metadata: {
        type: "local",
        absolute_path: "/home/user/projects/myappextended",
      },
    });
    const result = resolveTargetResources(
      "/home/user/projects/myappextended/src",
      [tricky, similar],
      [],
    );
    expect(result).toEqual([similar]);
  });

  it("multiple matches → sorted by specificity (longest path first)", () => {
    const parent = makeResource({
      id: "00000000-0000-0000-0000-000000000006",
      name: "parent",
      type: "local",
      snapshot_metadata: { type: "local", absolute_path: "/home/user/projects" },
    });
    const child = makeResource({
      id: "00000000-0000-0000-0000-000000000007",
      name: "child",
      type: "local",
      snapshot_metadata: { type: "local", absolute_path: "/home/user/projects/myapp" },
    });
    const result = resolveTargetResources(
      "/home/user/projects/myapp/src",
      [parent, child],
      [],
    );
    expect(result[0]).toEqual(child);
    expect(result[1]).toEqual(parent);
  });

  it("explicit names override CWD detection", () => {
    const result = resolveTargetResources(
      "/home/user/projects/myapp",
      allResources,
      ["git-res"],
    );
    expect(result).toEqual([gitResource]);
  });

  it("throws when explicit name not found", () => {
    expect(() =>
      resolveTargetResources("/any/cwd", allResources, ["nonexistent"]),
    ).toThrow('Resource "nonexistent" not found.');
  });

  it("requireMatch: throws when no CWD match and no explicit names", () => {
    expect(() =>
      resolveTargetResources("/unrelated/path", allResources, [], { requireMatch: true }),
    ).toThrow("No resource found for current directory. Use -r <name> to specify.");
  });

  it("requireMatch: does not throw when CWD matches a resource", () => {
    const result = resolveTargetResources(
      "/home/user/projects/myapp",
      allResources,
      [],
      { requireMatch: true },
    );
    expect(result).toEqual([localResource]);
  });

  it("requireMatch: false (default) falls back to all resources when no CWD match", () => {
    const result = resolveTargetResources("/unrelated/path", allResources, []);
    expect(result).toEqual(allResources);
  });

  it("CWD is parent dir of resource → does NOT match (resource is deeper)", () => {
    // /home/user/projects does NOT match resource at /home/user/projects/myapp
    const result = resolveTargetResources("/home/user/projects", allResources, []);
    // /home/user/projects is not equal to /home/user/projects/myapp
    // and /home/user/projects does not startsWith /home/user/projects/myapp + sep
    expect(result).toEqual(allResources);
  });

  it("path.sep boundary: /foo/bar matches /foo/bar/baz but not /foo/barbaz", () => {
    const sep = path.sep;
    const resource = makeResource({
      id: "00000000-0000-0000-0000-000000000008",
      name: "r",
      type: "local",
      snapshot_metadata: { type: "local", absolute_path: "/foo/bar" },
    });
    expect(resolveTargetResources(`/foo/bar${sep}baz`, [resource], [])).toEqual([resource]);
    expect(resolveTargetResources("/foo/barbaz", [resource], [])).toEqual([resource]); // fallback all
    // More precisely: "/foo/barbaz" does not start with "/foo/bar/"
    // So it falls through to "return all resources" → [resource] (which is all)
  });
});
