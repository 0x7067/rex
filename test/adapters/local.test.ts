import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { localAdapter } from "../../src/adapters/local.js";
import { createResource } from "../../src/core/resource.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rex-local-test-"));
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("LocalAdapter", () => {
  describe("detect", () => {
    it("detects relative paths", () => {
      expect(localAdapter.detect("./some/path")).toBe(true);
    });

    it("detects parent-relative paths", () => {
      expect(localAdapter.detect("../other")).toBe(true);
    });

    it("detects absolute paths", () => {
      expect(localAdapter.detect("/usr/local/lib")).toBe(true);
    });

    it("rejects https URLs", () => {
      expect(localAdapter.detect("https://github.com/org/repo")).toBe(false);
    });

    it("rejects git SSH URLs", () => {
      expect(localAdapter.detect("git@github.com:org/repo")).toBe(false);
    });

    it("rejects bare package names", () => {
      expect(localAdapter.detect("express")).toBe(false);
    });
  });

  describe("normalize", () => {
    it("resolves relative paths to absolute", () => {
      return expect(localAdapter.normalize(tmpDir)).resolves.toSatisfy(path.isAbsolute);
    });

    it("throws for non-existent paths", () => {
      return expect(
        localAdapter.normalize("/nonexistent-path-xyz-abc"),
      ).rejects.toThrow();
    });
  });

  describe("materialize", () => {
    it("returns local snapshot metadata for existing dir", async () => {
      const meta = await localAdapter.materialize(tmpDir, tmpDir);
      expect(meta.type).toBe("local");
      if (meta.type === "local") {
        expect(meta.absolute_path).toBe(tmpDir);
      }
    });

    it("throws for non-existent path", async () => {
      await expect(
        localAdapter.materialize("/nonexistent-xyz", tmpDir),
      ).rejects.toThrow();
    });
  });

  describe("reference", () => {
    it("formats citation as name: path", () => {
      const resource = createResource({
        name: "my-project",
        type: "local",
        source: tmpDir,
        normalized_source: tmpDir,
        notes: "",
        include_rules: [],
        exclude_rules: [],
        snapshot_metadata: { type: "local", absolute_path: tmpDir },
      });
      const entry = {
        absolutePath: path.join(tmpDir, "src/index.ts"),
        relativePath: "src/index.ts",
        sizeBytes: 100,
      };
      expect(localAdapter.reference(entry, resource)).toBe(
        "my-project: src/index.ts",
      );
    });
  });
});
