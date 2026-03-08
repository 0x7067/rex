import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  acquireResourceAddLock,
  isResourceAddLocked,
  releaseResourceAddLock,
} from "../../src/core/locks.js";

let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rex-locks-test-"));
  process.env["REX_HOME"] = tmpDir;
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  delete process.env["REX_HOME"];
});

describe("resource add locks", () => {
  it("acquires, reports, and releases an add lock", () => {
    expect(acquireResourceAddLock("resource-1")).toBe(true);
    expect(isResourceAddLocked("resource-1")).toBe(true);

    releaseResourceAddLock("resource-1");
    expect(isResourceAddLocked("resource-1")).toBe(false);
  });
});
