import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createResource } from "../../src/core/resource.js";
import { packageAdapter } from "../../src/adapters/package.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rex-package-test-"));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    ...init,
  });
}

function makePackageTarball(): Buffer {
  const fixtureDir = fs.mkdtempSync(path.join(os.tmpdir(), "rex-package-fixture-"));
  const packageDir = path.join(fixtureDir, "package");
  fs.mkdirSync(packageDir, { recursive: true });
  fs.writeFileSync(
    path.join(packageDir, "package.json"),
    JSON.stringify({ name: "ms", version: "2.1.3", main: "index.js" }, null, 2),
  );
  fs.writeFileSync(path.join(packageDir, "index.js"), "module.exports = 'ok';\n");

  const tarballPath = path.join(fixtureDir, "ms-2.1.3.tgz");
  execFileSync("tar", ["-czf", tarballPath, "-C", fixtureDir, "package"]);
  const tarball = fs.readFileSync(tarballPath);

  fs.rmSync(fixtureDir, { recursive: true, force: true });
  return tarball;
}

describe("PackageAdapter", () => {
  describe("normalize", () => {
    it("resolves the latest version from registry metadata", async () => {
      const fetchMock = vi.fn().mockResolvedValue(
        jsonResponse({ "dist-tags": { latest: "2.1.3" } }),
      );
      vi.stubGlobal("fetch", fetchMock);

      await expect(packageAdapter.normalize("ms")).resolves.toBe("npm:ms@2.1.3");
      expect(fetchMock).toHaveBeenCalledOnce();
    });

    it("does not fetch when the source already includes a version", async () => {
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);

      await expect(packageAdapter.normalize("npm:ms@2.1.3")).resolves.toBe("npm:ms@2.1.3");
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });

  describe("materialize", () => {
    it("downloads and extracts a tarball from registry metadata", async () => {
      const tarball = makePackageTarball();
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(
          jsonResponse({
            dist: { tarball: "https://registry.npmjs.org/ms/-/ms-2.1.3.tgz" },
          }),
        )
        .mockResolvedValueOnce(new Response(tarball));
      vi.stubGlobal("fetch", fetchMock);

      const metadata = await packageAdapter.materialize("npm:ms@2.1.3", tmpDir);

      expect(metadata).toMatchObject({
        type: "package",
        package_name: "ms",
        resolved_version: "2.1.3",
        registry_url: "https://registry.npmjs.org/ms",
      });
      expect(fs.readFileSync(path.join(metadata.extract_path, "index.js"), "utf8")).toContain("ok");
      expect(fs.existsSync(path.join(metadata.extract_path, "ms-2.1.3.tgz"))).toBe(false);
    });

    it("cleans up extracted state when the tarball request fails", async () => {
      const fetchMock = vi
        .fn()
        .mockResolvedValueOnce(
          jsonResponse({
            dist: { tarball: "https://registry.npmjs.org/ms/-/ms-2.1.3.tgz" },
          }),
        )
        .mockResolvedValueOnce(new Response("boom", { status: 500 }));
      vi.stubGlobal("fetch", fetchMock);

      await expect(
        packageAdapter.materialize("npm:ms@2.1.3", tmpDir),
      ).rejects.toThrow("Failed to extract package npm:ms@2.1.3");
      expect(fs.existsSync(path.join(tmpDir, "ms@2.1.3"))).toBe(false);
    });
  });

  describe("reference", () => {
    it("formats citation as package@version: path", () => {
      const resource = createResource({
        name: "ms",
        type: "package",
        source: "ms",
        normalized_source: "npm:ms@2.1.3",
        notes: "",
        include_rules: [],
        exclude_rules: [],
        snapshot_metadata: {
          type: "package",
          extract_path: "/tmp/ms@2.1.3",
          package_name: "ms",
          resolved_version: "2.1.3",
          registry_url: "https://registry.npmjs.org/ms",
        },
      });
      const entry = {
        absolutePath: "/tmp/ms@2.1.3/index.js",
        relativePath: "index.js",
        sizeBytes: 21,
      };

      expect(packageAdapter.reference(entry, resource)).toBe("ms@2.1.3: index.js");
    });
  });
});
