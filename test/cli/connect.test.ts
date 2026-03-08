import { Command } from "commander";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { registerConnect } from "../../src/cli/connect.js";

const mockSetProvider = vi.fn();

vi.mock("../../src/core/registry.js", () => ({
  setProvider: (...args: unknown[]) => mockSetProvider(...args),
}));

describe("registerConnect", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("defaults claude to the haiku model when no model is provided", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const program = new Command();
    program.option("--json");
    registerConnect(program);

    await program.parseAsync(["connect", "claude"], { from: "user" });

    expect(mockSetProvider).toHaveBeenCalledWith({
      name: "claude",
      model: "haiku",
      endpoint: null,
    });
    expect(logSpy).toHaveBeenCalledWith("Provider set: claude, model: haiku");

    logSpy.mockRestore();
  });

  it("keeps an explicit claude model override", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const program = new Command();
    program.option("--json");
    registerConnect(program);

    await program.parseAsync(["connect", "claude", "--model", "sonnet"], { from: "user" });

    expect(mockSetProvider).toHaveBeenCalledWith({
      name: "claude",
      model: "sonnet",
      endpoint: null,
    });
    expect(logSpy).toHaveBeenCalledWith("Provider set: claude, model: sonnet");

    logSpy.mockRestore();
  });
});
