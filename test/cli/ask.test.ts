import { Command } from "commander";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RetryableProviderError } from "../../src/provider/interface.js";
import { registerAsk } from "../../src/cli/ask.js";

const mockGetProvider = vi.fn();
const mockListResources = vi.fn();
const mockGetResourceByName = vi.fn();
const mockGetSummaries = vi.fn();
const mockRetrieve = vi.fn();
const mockGenerateAnswer = vi.fn();

vi.mock("../../src/core/registry.js", () => ({
  getProvider: (...args: unknown[]) => mockGetProvider(...args),
  listResources: (...args: unknown[]) => mockListResources(...args),
  getResourceByName: (...args: unknown[]) => mockGetResourceByName(...args),
}));

vi.mock("../../src/indexing/store.js", () => ({
  getSummaries: (...args: unknown[]) => mockGetSummaries(...args),
}));

vi.mock("../../src/query/retriever.js", () => ({
  retrieve: (...args: unknown[]) => mockRetrieve(...args),
}));

vi.mock("../../src/query/answerer.js", () => ({
  generateAnswer: (...args: unknown[]) => mockGenerateAnswer(...args),
}));

describe("registerAsk", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSummaries.mockResolvedValue([]);
    mockRetrieve.mockResolvedValue([]);
  });

  it("uses the fast codex profile first and retries once with the clean profile", async () => {
    mockGetProvider.mockReturnValue({ name: "codex", model: null, endpoint: null });
    mockListResources.mockReturnValue([
      { id: "r1", name: "rex", last_sync_status: "ok" },
    ]);
    mockGenerateAnswer
      .mockRejectedValueOnce(new RetryableProviderError("meta chatter", "codex"))
      .mockResolvedValueOnce({ answer: "hello", sources: [] });

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const program = new Command();
    program.option("--json");
    registerAsk(program);

    await program.parseAsync(["--json", "ask", "how does the chunker work?"], { from: "user" });

    expect(mockRetrieve).toHaveBeenNthCalledWith(
      1,
      "how does the chunker work?",
      ["r1"],
      expect.objectContaining({
        perResourceCap: 4,
        totalCap: 12,
        collapseByFile: true,
        pathBias: "codex-fast",
      }),
    );
    expect(mockRetrieve).toHaveBeenNthCalledWith(
      2,
      "how does the chunker work?",
      ["r1"],
      expect.objectContaining({
        perResourceCap: 10,
        totalCap: 40,
      }),
    );
    expect(mockGenerateAnswer).toHaveBeenNthCalledWith(
      1,
      expect.any(Array),
      expect.any(Array),
      expect.any(Array),
      "how does the chunker work?",
      { name: "codex", model: null, endpoint: null },
      expect.objectContaining({ profile: "fast" }),
    );
    expect(mockGenerateAnswer).toHaveBeenNthCalledWith(
      2,
      expect.any(Array),
      expect.any(Array),
      expect.any(Array),
      "how does the chunker work?",
      { name: "codex", model: null, endpoint: null },
      expect.objectContaining({ profile: "clean" }),
    );

    logSpy.mockRestore();
  });

  it("prints only validated cited sources with line ranges in human output", async () => {
    mockGetProvider.mockReturnValue({ name: "ollama", model: null, endpoint: null });
    mockListResources.mockReturnValue([
      { id: "r1", name: "ravn", last_sync_status: "ok" },
    ]);
    mockGenerateAnswer.mockResolvedValue({
      answer: "Ravn has offices in three cities.",
      sources: [
        {
          resource: "ravn",
          path: "office-locations.md",
          lines: [1, 18],
        },
      ],
    });

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const program = new Command();
    program.option("--json");
    registerAsk(program);

    await program.parseAsync(["ask", "where are the offices located"], { from: "user" });

    expect(logSpy).toHaveBeenCalledWith("\nSources:");
    expect(logSpy).toHaveBeenCalledWith("  - ravn: office-locations.md (lines 1-18)");

    logSpy.mockRestore();
  });

  it("includes line ranges in json output", async () => {
    mockGetProvider.mockReturnValue({ name: "ollama", model: null, endpoint: null });
    mockListResources.mockReturnValue([
      { id: "r1", name: "ravn", last_sync_status: "ok" },
    ]);
    mockGenerateAnswer.mockResolvedValue({
      answer: "Ravn has offices in three cities.",
      sources: [
        {
          resource: "ravn",
          path: "office-locations.md",
          lines: [1, 18],
        },
      ],
    });

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

    const program = new Command();
    program.option("--json");
    registerAsk(program);

    await program.parseAsync(["--json", "ask", "where are the offices located"], { from: "user" });

    expect(logSpy).toHaveBeenCalledWith(JSON.stringify({
      answer: "Ravn has offices in three cities.",
      sources: [
        {
          resource: "ravn",
          path: "office-locations.md",
          lines: [1, 18],
        },
      ],
      resources_queried: ["ravn"],
      resources_skipped: [],
    }));

    logSpy.mockRestore();
  });
});
