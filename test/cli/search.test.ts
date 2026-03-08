import { Command } from "commander";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { registerSearch } from "../../src/cli/search.js";

const mockListResources = vi.fn();
const mockResolveTargetResources = vi.fn();
const mockRetrieve = vi.fn();
const mockFindCallers = vi.fn();
const mockFindCallees = vi.fn();

vi.mock("../../src/core/registry.js", () => ({
  listResources: (...args: unknown[]) => mockListResources(...args),
}));

vi.mock("../../src/query/resolve-target.js", () => ({
  resolveTargetResources: (...args: unknown[]) => mockResolveTargetResources(...args),
}));

vi.mock("../../src/query/retriever.js", () => ({
  retrieve: (...args: unknown[]) => mockRetrieve(...args),
}));

vi.mock("../../src/analysis/callgraph.js", () => ({
  findCallers: (...args: unknown[]) => mockFindCallers(...args),
  findCallees: (...args: unknown[]) => mockFindCallees(...args),
}));

const okResource = { id: "r1", name: "my-project", last_sync_status: "ok" };

describe("registerSearch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockListResources.mockReturnValue([okResource]);
    mockResolveTargetResources.mockReturnValue([okResource]);
    mockRetrieve.mockResolvedValue([]);
  });

  it("outputs grep-like format for human output", async () => {
    mockRetrieve.mockResolvedValue([
      {
        resource_id: "r1",
        resource_name: "my-project",
        file_path: "src/index.ts",
        chunk_index: 0,
        start_line: 1,
        end_line: 45,
        text: "export function main() {\n  console.log('hello');\n}",
        score: 0.82,
      },
    ]);

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const program = new Command();
    program.option("--json");
    registerSearch(program);
    await program.parseAsync(["search", "-q", "main function"], { from: "user" });

    expect(logSpy).toHaveBeenCalledWith(
      expect.stringMatching(/my-project:src\/index\.ts:1-45 \(0\.82\)/),
    );
    logSpy.mockRestore();
  });

  it("outputs JSON structure with --json flag", async () => {
    mockRetrieve.mockResolvedValue([
      {
        resource_id: "r1",
        resource_name: "my-project",
        file_path: "src/index.ts",
        chunk_index: 0,
        start_line: 1,
        end_line: 45,
        text: "line one\nline two\nline three",
        score: 0.82,
      },
    ]);

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const program = new Command();
    program.option("--json");
    registerSearch(program);
    await program.parseAsync(["--json", "search", "-q", "main function"], { from: "user" });

    const output = JSON.parse((logSpy.mock.calls[0] as string[])[0]!);
    expect(output).toMatchObject({
      results: [
        {
          resource: "my-project",
          file: "src/index.ts",
          lines: [1, 45],
          score: 0.82,
          snippet: "line one\nline two",
        },
      ],
      resources_queried: ["my-project"],
      resources_skipped: [],
    });
    logSpy.mockRestore();
  });

  it("passes --limit as totalCap and perResourceCap to retrieve", async () => {
    const program = new Command();
    program.option("--json");
    registerSearch(program);
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    await program.parseAsync(["search", "-q", "query", "--limit", "5"], { from: "user" });

    expect(mockRetrieve).toHaveBeenCalledWith(
      "query",
      ["r1"],
      expect.objectContaining({ totalCap: 5, perResourceCap: 5 }),
    );
    logSpy.mockRestore();
  });

  it("uses CWD auto-detection via resolveTargetResources when no -r given", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const program = new Command();
    program.option("--json");
    registerSearch(program);
    await program.parseAsync(["search", "-q", "something"], { from: "user" });

    expect(mockResolveTargetResources).toHaveBeenCalledWith(
      process.cwd(),
      expect.any(Array),
      [], // no explicit resource names
      { requireMatch: true },
    );
    logSpy.mockRestore();
  });

  it("outputs --callers results in human format", async () => {
    mockFindCallers.mockReturnValue([
      {
        resource_name: "my-project",
        file_path: "src/cli/ask.ts",
        line: 151,
        context: "const chunks = await retrieve(",
        kind: "call",
      },
    ]);

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const program = new Command();
    program.option("--json");
    registerSearch(program);
    await program.parseAsync(["search", "--callers", "retrieve"], { from: "user" });

    expect(logSpy).toHaveBeenCalledWith('Callers of "retrieve":');
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining("src/cli/ask.ts:151"),
    );
    logSpy.mockRestore();
  });

  it("outputs --callees results in JSON format", async () => {
    mockFindCallees.mockReturnValue([
      {
        resource_name: "my-project",
        file_path: "src/core/sync.ts",
        line: 68,
        context: "indexResourceFiles({",
        kind: "call",
      },
    ]);

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const program = new Command();
    program.option("--json");
    registerSearch(program);
    await program.parseAsync(["--json", "search", "--callees", "syncResource"], { from: "user" });

    const output = JSON.parse((logSpy.mock.calls[0] as string[])[0]!);
    expect(output).toHaveProperty("hits");
    expect(output.hits).toHaveLength(1);
    logSpy.mockRestore();
  });

  it("filters out results above --threshold", async () => {
    mockRetrieve.mockResolvedValue([
      {
        resource_id: "r1",
        resource_name: "my-project",
        file_path: "src/index.ts",
        chunk_index: 0,
        start_line: 1,
        end_line: 10,
        text: "relevant",
        score: 0.4,
      },
      {
        resource_id: "r1",
        resource_name: "my-project",
        file_path: "src/other.ts",
        chunk_index: 0,
        start_line: 1,
        end_line: 5,
        text: "irrelevant",
        score: 1.2,
      },
    ]);

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const program = new Command();
    program.option("--json");
    registerSearch(program);
    await program.parseAsync(
      ["--json", "search", "-q", "query", "--threshold", "1.0"],
      { from: "user" },
    );

    const output = JSON.parse((logSpy.mock.calls[0] as string[])[0]!);
    expect(output.results).toHaveLength(1);
    expect(output.results[0].file).toBe("src/index.ts");
    logSpy.mockRestore();
  });

  it("prints 'No relevant results found.' when all results exceed threshold", async () => {
    mockRetrieve.mockResolvedValue([
      {
        resource_id: "r1",
        resource_name: "my-project",
        file_path: "src/index.ts",
        chunk_index: 0,
        start_line: 1,
        end_line: 5,
        text: "irrelevant",
        score: 1.5,
      },
    ]);

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const program = new Command();
    program.option("--json");
    registerSearch(program);
    await program.parseAsync(["search", "-q", "query", "--threshold", "1.0"], { from: "user" });

    expect(logSpy).toHaveBeenCalledWith("No relevant results found.");
    logSpy.mockRestore();
    errSpy.mockRestore();
  });

  it("JSON mode: returns empty results array when all filtered by threshold", async () => {
    mockRetrieve.mockResolvedValue([
      {
        resource_id: "r1",
        resource_name: "my-project",
        file_path: "src/index.ts",
        chunk_index: 0,
        start_line: 1,
        end_line: 5,
        text: "irrelevant",
        score: 1.5,
      },
    ]);

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const program = new Command();
    program.option("--json");
    registerSearch(program);
    await program.parseAsync(
      ["--json", "search", "-q", "query", "--threshold", "1.0"],
      { from: "user" },
    );

    const output = JSON.parse((logSpy.mock.calls[0] as string[])[0]!);
    expect(output.results).toEqual([]);
    logSpy.mockRestore();
  });

  it("prints error and exits when resolveTargetResources throws (CWD not matched)", async () => {
    mockResolveTargetResources.mockImplementation(() => {
      throw new Error("No resource found for current directory. Use -r <name> to specify.");
    });

    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
      throw new Error(`process.exit(${code})`);
    }) as () => never);
    const program = new Command();
    program.option("--json");
    registerSearch(program);
    await expect(
      program.parseAsync(["search", "-q", "query"], { from: "user" }),
    ).rejects.toThrow("process.exit(2)");

    expect(errSpy).toHaveBeenCalledWith(
      "No resource found for current directory. Use -r <name> to specify.",
    );
    expect(exitSpy).toHaveBeenCalledWith(2);
    errSpy.mockRestore();
    exitSpy.mockRestore();
  });

  it("skips resources with pending or failed status", async () => {
    const pendingResource = { id: "r2", name: "pending-proj", last_sync_status: "pending" };
    mockResolveTargetResources.mockReturnValue([okResource, pendingResource]);

    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const program = new Command();
    program.option("--json");
    registerSearch(program);
    await program.parseAsync(["--json", "search", "-q", "query"], { from: "user" });

    const output = JSON.parse((logSpy.mock.calls[0] as string[])[0]!);
    expect(output.resources_queried).toEqual(["my-project"]);
    expect(output.resources_skipped).toHaveLength(1);
    expect(output.resources_skipped[0].name).toBe("pending-proj");
    logSpy.mockRestore();
  });
});
