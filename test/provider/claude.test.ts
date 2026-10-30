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
    const [binary, args, options] = mockExeca.mock.calls[0] as [
      string,
      string[],
      Record<string, unknown>,
    ];
    expect(binary).toBe("claude");
    expect(args).toEqual(
      expect.arrayContaining([
        "-p",
        "--tools",
        "",
        "--disallowedTools",
        "mcp__*",
        "--safe-mode",
        "--strict-mcp-config",
        "--mcp-config",
        '{"mcpServers":{}}',
        "--settings",
        '{"disableAllHooks":true}',
        "--output-format",
        "json",
        "--no-session-persistence",
        "--model",
        "sonnet",
      ]),
    );
    expect(args).not.toContain("--dangerously-skip-permissions");
    expect(options).toEqual(
      expect.objectContaining({
        cwd: os.tmpdir(),
        input: "Answer this.",
        timeout: 120_000,
      }),
    );
  });
});

describe("Claude result validation", () => {
  it("rejects a CLI error even when it contains a result string", async () => {
    mockExeca.mockResolvedValueOnce({
      stdout: JSON.stringify({ is_error: true, result: "fixture failure" }),
    });
    await expect(
      new ClaudeProvider({ name: "claude", model: null, endpoint: null }).call(
        "q",
      ),
    ).rejects.toThrow("malformed response");
  });
  it("rejects malformed JSON output", async () => {
    mockExeca.mockResolvedValueOnce({ stdout: "not json" });
    await expect(
      new ClaudeProvider({ name: "claude", model: null, endpoint: null }).call(
        "q",
      ),
    ).rejects.toThrow("invalid JSON");
  });
});
