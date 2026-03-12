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
    expect(logSpy).toHaveBeenCalledWith('Provider configured: claude (model: haiku)');
    expect(logSpy).toHaveBeenCalledWith("Next: rex add ./some-project");

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
    expect(logSpy).toHaveBeenCalledWith('Provider configured: claude (model: sonnet)');
    expect(logSpy).toHaveBeenCalledWith("Next: rex add ./some-project");

    logSpy.mockRestore();
  });

  it("guides the user toward a valid provider when the provider name is unknown", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = vi
      .spyOn(process, "exit")
      .mockImplementation(((code?: number) => {
        throw new Error(`process.exit(${code})`);
      }) as () => never);

    const program = new Command();
    program.option("--json");
    registerConnect(program);

    await expect(
      program.parseAsync(["connect", "unknown"], { from: "user" }),
    ).rejects.toThrow("process.exit(1)");

    expect(errSpy).toHaveBeenCalledWith(
      'Unknown provider "unknown". Choose one of: claude, codex, ollama.',
    );
    expect(errSpy).toHaveBeenCalledWith("Example: rex connect claude");

    errSpy.mockRestore();
    exitSpy.mockRestore();
  });
});
