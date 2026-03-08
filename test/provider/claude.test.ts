import os from "node:os";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockExeca = vi.fn();

vi.mock("execa", () => ({
  execa: (...args: unknown[]) => mockExeca(...args),
}));

const { ClaudeProvider } = await import("../../src/provider/claude.js");

describe("ClaudeProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses a non-persistent one-shot session from a temp working directory", async () => {
    mockExeca.mockResolvedValue({
      stdout: JSON.stringify({ result: "hello" }),
    });

    const provider = new ClaudeProvider({
      name: "claude",
      model: "sonnet",
      endpoint: null,
    });

    await provider.call("Answer this.");

    expect(mockExeca).toHaveBeenCalledOnce();
    const [binary, args, options] = mockExeca.mock.calls[0] as [string, string[], Record<string, unknown>];
    expect(binary).toBe("claude");
    expect(args).toEqual(expect.arrayContaining([
      "-p",
      "--dangerously-skip-permissions",
      "--output-format",
      "json",
      "--no-session-persistence",
      "--model",
      "sonnet",
    ]));
    expect(options).toEqual(expect.objectContaining({
      cwd: os.tmpdir(),
      input: "Answer this.",
      timeout: 120_000,
    }));
  });
});
