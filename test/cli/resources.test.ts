import { Command } from "commander";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { registerResources } from "../../src/cli/resources.js";

const mockListResources = vi.fn();
const mockGetResourceByName = vi.fn();

vi.mock("../../src/core/registry.js", () => ({
  listResources: (...args: unknown[]) => mockListResources(...args),
  getResourceByName: (...args: unknown[]) => mockGetResourceByName(...args),
}));

describe("registerResources", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows onboarding guidance when no resources exist", async () => {
    mockListResources.mockReturnValue([]);

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const program = new Command();
    program.option("--json");
    registerResources(program);

    await program.parseAsync(["resources"], { from: "user" });

    expect(logSpy).toHaveBeenCalledWith(
      [
        "No resources added yet.",
        "Start here:",
        "  rex connect claude",
        "  rex add ./some-project",
      ].join("\n"),
    );

    logSpy.mockRestore();
  });
});
