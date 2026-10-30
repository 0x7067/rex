import { beforeEach, describe, expect, it, vi } from "vitest";

const mockExeca = vi.fn();

vi.mock("execa", () => ({
  execa: (...args: unknown[]) => mockExeca(...args),
}));

const { CodexProvider } = await import("../../src/provider/codex.js");

describe("CodexProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses a lean read-only exec profile instead of full-auto", async () => {
    mockExeca.mockResolvedValue({
      stdout: JSON.stringify({
        type: "item.completed",
        item: { type: "agent_message", text: "hello" },
      }),
    });

    const provider = new CodexProvider({
      name: "codex",
      model: "gpt-5.2",
      endpoint: null,
    });

    await provider.call("Answer this.");

    expect(mockExeca).toHaveBeenCalledOnce();
    const [binary, args, options] = mockExeca.mock.calls[0] as [
      string,
      string[],
      Record<string, unknown>,
    ];
    expect(binary).toBe("codex");
    expect(args).toEqual(
      expect.arrayContaining([
        "exec",
        "--json",
        "--skip-git-repo-check",
        "--ephemeral",
        "--sandbox",
        "read-only",
        "-C",
      ]),
    );
    expect(args).not.toContain("--full-auto");
    expect(options).toEqual(
      expect.objectContaining({
        input: expect.stringContaining("Answer this."),
        timeout: 90_000,
      }),
    );
  });

  it("returns only the cleaned final answer instead of intermediate agent chatter", async () => {
    mockExeca.mockResolvedValue({
      stdout: [
        JSON.stringify({
          type: "item.completed",
          item: {
            type: "agent_message",
            text: "I’m loading the required startup skill first so I can follow the workspace instructions.",
          },
        }),
        JSON.stringify({
          type: "item.completed",
          item: {
            type: "agent_message",
            text: "Using `using-superpowers` as required by this workspace, hello.",
          },
        }),
      ].join("\n"),
    });

    const provider = new CodexProvider({
      name: "codex",
      model: null,
      endpoint: null,
    });

    await expect(provider.call("Answer this.")).resolves.toBe("hello.");
  });

  it("throws a retryable provider error when the fast profile only returns meta chatter", async () => {
    mockExeca.mockResolvedValue({
      stdout: JSON.stringify({
        type: "item.completed",
        item: {
          type: "agent_message",
          text: "I’m checking the session skill instructions first so I can follow the repo workflow.",
        },
      }),
    });

    const provider = new CodexProvider({
      name: "codex",
      model: null,
      endpoint: null,
    });

    await expect(provider.call("Answer this.")).rejects.toMatchObject({
      name: "RetryableProviderError",
      providerName: "codex",
    });
  });
});

describe("Codex event contract", () => {
  it("does not treat arbitrary JSON events as an answer", async () => {
    mockExeca.mockResolvedValueOnce({
      stdout: JSON.stringify({ type: "error", message: "fixture failure" }),
    });
    await expect(
      new CodexProvider({ name: "codex", model: null, endpoint: null }).call(
        "q",
      ),
    ).rejects.toThrow("no final agent message");
  });
});
