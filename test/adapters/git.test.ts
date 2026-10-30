import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { gitAdapter } from "../../src/adapters/git.js";
let root: string;
beforeEach(() => {
  root = fs.mkdtempSync(
    path.join(fs.existsSync("/dev/shm") ? "/dev/shm" : os.tmpdir(), "rex-git-"),
  );
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));
function repo(owner: string, text: string) {
  const dir = path.join(root, owner, "same");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "identity.md"), text);
  execFileSync("git", ["init", "-q", dir]);
  execFileSync("git", ["-C", dir, "add", "identity.md"]);
  execFileSync("git", [
    "-C",
    dir,
    "-c",
    "user.name=Fixture",
    "-c",
    "user.email=fixture@example.invalid",
    "commit",
    "-qm",
    "fixture",
  ]);
  return `file://${dir}`;
}
describe("git snapshot identity", () => {
  it("keeps same-name repositories from separate owners in different snapshots", async () => {
    const snapshots = path.join(root, "snapshots");
    const a = await gitAdapter.materialize(repo("a", "PROJECT A"), snapshots);
    const b = await gitAdapter.materialize(repo("b", "PROJECT B"), snapshots);
    expect(a.type).toBe("git");
    expect(b.type).toBe("git");
    if (a.type !== "git" || b.type !== "git")
      throw new Error("Expected git snapshots");
    expect(a.clone_path).not.toBe(b.clone_path);
    expect(
      fs.readFileSync(path.join(b.clone_path, "identity.md"), "utf8"),
    ).toBe("PROJECT B");
  });
  it("rejects a snapshot whose origin was replaced", async () => {
    const source = repo("a", "PROJECT A");
    const snapshots = path.join(root, "snapshots");
    const snapshot = await gitAdapter.materialize(source, snapshots);
    if (snapshot.type !== "git") throw new Error("Expected git snapshot");
    execFileSync("git", [
      "-C",
      snapshot.clone_path,
      "remote",
      "set-url",
      "origin",
      repo("b", "PROJECT B"),
    ]);
    await expect(gitAdapter.materialize(source, snapshots)).rejects.toThrow(
      "does not match",
    );
  });
});
