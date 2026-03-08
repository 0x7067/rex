import { afterEach, beforeEach, describe, expect, it } from "vitest";
import path from "node:path";
import os from "node:os";
import { lanceDir, registryPath, rexHome, snapshotsDir } from "../../src/core/config.js";

describe("config", () => {
  const original = process.env["REX_HOME"];

  afterEach(() => {
    if (original === undefined) {
      delete process.env["REX_HOME"];
    } else {
      process.env["REX_HOME"] = original;
    }
  });

  describe("rexHome", () => {
    it("defaults to ~/.rex", () => {
      delete process.env["REX_HOME"];
      expect(rexHome()).toBe(path.join(os.homedir(), ".rex"));
    });

    it("respects REX_HOME env var", () => {
      process.env["REX_HOME"] = "/tmp/test-rex-42";
      expect(rexHome()).toBe("/tmp/test-rex-42");
    });
  });

  describe("derived paths", () => {
    beforeEach(() => {
      process.env["REX_HOME"] = "/tmp/test-rex";
    });

    it("snapshotsDir is under rexHome", () => {
      expect(snapshotsDir()).toBe("/tmp/test-rex/snapshots");
    });

    it("lanceDir is under rexHome", () => {
      expect(lanceDir()).toBe("/tmp/test-rex/lance");
    });

    it("registryPath is under rexHome", () => {
      expect(registryPath()).toBe("/tmp/test-rex/registry.json");
    });
  });
});
