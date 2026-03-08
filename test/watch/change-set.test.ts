import { describe, expect, it } from "vitest";
import { categorizeChange } from "../../src/watch/change-set.js";

const ROOT = "/home/user/projects/myapp";

describe("categorizeChange", () => {
  it("valid TS file returns FileChange", () => {
    const result = categorizeChange("change", "src/index.ts", ROOT, []);
    expect(result).not.toBeNull();
    expect(result!.absolutePath).toBe(`${ROOT}/src/index.ts`);
    expect(result!.relativePath).toBe("src/index.ts");
  });

  it("valid JS file returns FileChange", () => {
    const result = categorizeChange("change", "lib/helper.js", ROOT, []);
    expect(result).not.toBeNull();
  });

  it("binary file (png) returns null", () => {
    const result = categorizeChange("change", "assets/logo.png", ROOT, []);
    expect(result).toBeNull();
  });

  it("binary file (jpg) returns null", () => {
    const result = categorizeChange("change", "images/photo.jpg", ROOT, []);
    expect(result).toBeNull();
  });

  it("binary file (zip) returns null", () => {
    const result = categorizeChange("change", "archive.zip", ROOT, []);
    expect(result).toBeNull();
  });

  it("node_modules path returns null (default exclude)", () => {
    const result = categorizeChange("change", "node_modules/package/index.js", ROOT, []);
    expect(result).toBeNull();
  });

  it("dist path returns null (default exclude)", () => {
    const result = categorizeChange("change", "dist/bundle.js", ROOT, []);
    expect(result).toBeNull();
  });

  it(".git path returns null (default exclude)", () => {
    const result = categorizeChange("change", ".git/COMMIT_EDITMSG", ROOT, []);
    expect(result).toBeNull();
  });

  it("custom exclude rule returns null", () => {
    const result = categorizeChange("change", "generated/schema.ts", ROOT, ["generated/**"]);
    expect(result).toBeNull();
  });

  it("eventType is not used for filtering (rename events pass)", () => {
    const result = categorizeChange("rename", "src/main.ts", ROOT, []);
    expect(result).not.toBeNull();
  });

  it("lock file returns null", () => {
    const result = categorizeChange("change", "package-lock.json", ROOT, []);
    expect(result).toBeNull();
  });
});
