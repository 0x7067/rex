import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const packageJson = JSON.parse(
  fs.readFileSync(path.resolve(process.cwd(), "package.json"), "utf-8"),
) as {
  name: string;
  version: string;
  bin: Record<string, string>;
  repository?: { type?: string; url?: string };
  homepage?: string;
  bugs?: { url?: string };
  publishConfig?: { access?: string; registry?: string };
};

describe("package metadata", () => {
  it("uses the scoped npm package and preserves the rex binary name", () => {
    expect(packageJson.name).toBe("@denguinho/rex");
    expect(packageJson.version).toMatch(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/);
    expect(packageJson.bin).toEqual({
      rex: "./dist/bin/rex.js",
    });
  });

  it("includes the repository metadata needed for publishing and support", () => {
    expect(packageJson.repository).toEqual({
      type: "git",
      url: "git+https://github.com/Denguinho/rex.git",
    });
    expect(packageJson.homepage).toBe("https://github.com/Denguinho/rex");
    expect(packageJson.bugs).toEqual({
      url: "https://github.com/Denguinho/rex/issues",
    });
    expect(packageJson.publishConfig).toEqual({
      access: "public",
      registry: "https://registry.npmjs.org/",
      tag: "alpha",
    });
  });
});
