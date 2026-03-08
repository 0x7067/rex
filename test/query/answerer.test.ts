import { describe, expect, it, vi, beforeEach } from "vitest";
import { createResource } from "../../src/core/resource.js";
import type { SummaryRow } from "../../src/indexing/store.js";
import type { RetrievedChunk } from "../../src/query/retriever.js";

// Mocks for generateSummaries
const mockProviderCall = vi.fn();
vi.mock("../../src/provider/interface.js", () => ({
  getProvider: () => ({ name: "ollama", call: mockProviderCall }),
}));

const mockWriteSummaries = vi.fn();
vi.mock("../../src/indexing/store.js", () => ({
  writeSummaries: mockWriteSummaries,
}));

const {
  buildPrompt,
  buildSummaryPrompt,
  generateAnswer,
  generateSummaries,
} = await import("../../src/query/answerer.js");

const resourceA = createResource({
  name: "project-a",
  type: "local",
  source: "./a",
  normalized_source: "/tmp/a",
  notes: "",
  include_rules: [],
  exclude_rules: [],
  snapshot_metadata: { type: "local", absolute_path: "/tmp/a" },
});

const resourceB = createResource({
  name: "project-b",
  type: "local",
  source: "./b",
  normalized_source: "/tmp/b",
  notes: "",
  include_rules: [],
  exclude_rules: [],
  snapshot_metadata: { type: "local", absolute_path: "/tmp/b" },
});

function makeSummary(resourceId: string, resourceName: string, blockType: string, content: string): SummaryRow {
  return {
    id: crypto.randomUUID(),
    resource_id: resourceId,
    resource_name: resourceName,
    block_type: blockType,
    content,
    generated_at: new Date().toISOString(),
    based_on_fingerprints: "[]",
  };
}

function makeChunk(resourceId: string, resourceName: string, filePath: string, text: string): RetrievedChunk {
  return {
    resource_id: resourceId,
    resource_name: resourceName,
    file_path: filePath,
    chunk_index: 0,
    start_line: 1,
    end_line: 10,
    text,
    score: 0.9,
  };
}

describe("buildPrompt", () => {
  it("includes system instruction", () => {
    const prompt = buildPrompt([], [], [], "test question");
    expect(prompt).toContain("[System]:");
    expect(prompt).toContain("Answer based only on the provided context");
  });

  it("includes the question", () => {
    const prompt = buildPrompt([], [], [], "what does this do?");
    expect(prompt).toContain("[Question]: what does this do?");
  });

  it("labels each resource section with name and id", () => {
    const prompt = buildPrompt([resourceA], [], [], "q");
    expect(prompt).toContain(`[Resource: project-a (id: ${resourceA.id})`);
  });

  it("includes summaries before chunks in each resource section", () => {
    const summary = makeSummary(resourceA.id, "project-a", "identity", "A TypeScript CLI tool");
    const chunk = makeChunk(resourceA.id, "project-a", "src/index.ts", "const main = () => {}");
    const prompt = buildPrompt([resourceA], [summary], [chunk], "q");

    const summaryPos = prompt.indexOf("A TypeScript CLI tool");
    const chunkPos = prompt.indexOf("const main = () => {}");
    expect(summaryPos).toBeLessThan(chunkPos);
  });

  it("keeps resource A and B context separate", () => {
    const summaryA = makeSummary(resourceA.id, "project-a", "identity", "This is project A");
    const summaryB = makeSummary(resourceB.id, "project-b", "identity", "This is project B");
    const chunkA = makeChunk(resourceA.id, "project-a", "a.ts", "code from A");
    const chunkB = makeChunk(resourceB.id, "project-b", "b.ts", "code from B");

    const prompt = buildPrompt(
      [resourceA, resourceB],
      [summaryA, summaryB],
      [chunkA, chunkB],
      "compare",
    );

    expect(prompt).toContain(`[Resource: project-a`);
    expect(prompt).toContain(`[Resource: project-b`);
    expect(prompt).toContain("code from A");
    expect(prompt).toContain("code from B");
  });

  it("labels chunks with file path", () => {
    const chunk = makeChunk(resourceA.id, "project-a", "src/index.ts", "export default {}");
    const prompt = buildPrompt([resourceA], [], [chunk], "q");
    expect(prompt).toContain("--- File: src/index.ts");
  });
});

describe("buildSummaryPrompt", () => {
  it("includes the resource name in the prompt", () => {
    const prompt = buildSummaryPrompt("my-lib", "identity", "some context");
    expect(prompt).toContain("my-lib");
  });

  it("includes the context in the prompt", () => {
    const context = "export function foo() {}";
    const prompt = buildSummaryPrompt("my-lib", "identity", context);
    expect(prompt).toContain(context);
  });

  it("produces different prompts for each block type", () => {
    const identity = buildSummaryPrompt("lib", "identity", "ctx");
    const architecture = buildSummaryPrompt("lib", "architecture", "ctx");
    const conventions = buildSummaryPrompt("lib", "conventions", "ctx");
    expect(identity).not.toEqual(architecture);
    expect(architecture).not.toEqual(conventions);
  });
});

describe("generateSummaries", () => {
  const providerConfig = { name: "ollama" as const, model: null, endpoint: null };

  beforeEach(() => {
    vi.clearAllMocks();
    mockProviderCall.mockResolvedValue("A generated summary.");
    mockWriteSummaries.mockResolvedValue(undefined);
  });

  it("calls provider.call once per block type (3 times total)", async () => {
    await generateSummaries(resourceA, ["chunk text"], providerConfig);
    expect(mockProviderCall).toHaveBeenCalledTimes(3);
  });

  it("calls writeSummaries once with all 3 summary rows", async () => {
    await generateSummaries(resourceA, ["chunk text"], providerConfig);
    expect(mockWriteSummaries).toHaveBeenCalledOnce();
    const [rows] = mockWriteSummaries.mock.calls[0] as [unknown[]];
    expect(rows).toHaveLength(3);
  });

  it("includes correct resource_id and block_types in written rows", async () => {
    await generateSummaries(resourceA, ["chunk text"], providerConfig);
    const [rows] = mockWriteSummaries.mock.calls[0] as [Array<{ resource_id: string; block_type: string }>];
    expect(rows.map((r) => r.block_type).sort()).toEqual(["architecture", "conventions", "identity"]);
    expect(rows.every((r) => r.resource_id === resourceA.id)).toBe(true);
  });

  it("calls onProgress once per block type", async () => {
    const onProgress = vi.fn();
    await generateSummaries(resourceA, ["chunk text"], providerConfig, onProgress);
    expect(onProgress).toHaveBeenCalledTimes(3);
  });

  it("propagates provider errors", async () => {
    mockProviderCall.mockRejectedValue(new Error("LLM offline"));
    await expect(
      generateSummaries(resourceA, ["chunk text"], providerConfig),
    ).rejects.toThrow("LLM offline");
  });
});

describe("generateAnswer", () => {
  const providerConfig = { name: "ollama" as const, model: null, endpoint: null };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns only the sources explicitly cited by the model", async () => {
    mockProviderCall.mockResolvedValue(
      [
        "Ravn has offices in American Fork, Arequipa, and San Salvador.",
        "",
        "<rex_sources>",
        "ravn|office-locations.md",
        "</rex_sources>",
      ].join("\n"),
    );

    const answer = await generateAnswer(
      [resourceA],
      [],
      [
        makeChunk(resourceA.id, "ravn", "office-locations.md", "American Fork"),
        makeChunk(resourceA.id, "ravn", "engineering-general.md", "Engineering handbook"),
        makeChunk(resourceA.id, "ravn", "design.md", "Design handbook"),
      ],
      "where are the offices located",
      providerConfig,
    );

    expect(answer.answer).toContain("American Fork");
    expect(answer.answer).not.toContain("<rex_sources>");
    expect(answer.sources).toEqual([
      {
        resource: "ravn",
        path: "office-locations.md",
        lines: [1, 10],
      },
    ]);
  });

  it("drops citations that do not match retrieved chunks", async () => {
    mockProviderCall.mockResolvedValue(
      [
        "Ravn has offices in American Fork, Arequipa, and San Salvador.",
        "",
        "<rex_sources>",
        "ravn|office-locations.md|1|10",
        "ravn|engineering-general.md|200|220",
        "ravn|hallucinated.md|1|5",
        "</rex_sources>",
      ].join("\n"),
    );

    const answer = await generateAnswer(
      [resourceA],
      [],
      [
        makeChunk(resourceA.id, "ravn", "office-locations.md", "American Fork"),
        makeChunk(resourceA.id, "ravn", "engineering-general.md", "Engineering handbook"),
      ],
      "where are the offices located",
      providerConfig,
    );

    expect(answer.sources).toEqual([
      {
        resource: "ravn",
        path: "office-locations.md",
        lines: [1, 10],
      },
    ]);
  });
});
